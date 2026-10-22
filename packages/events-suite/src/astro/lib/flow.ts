/**
 * The page logic of `/_events/waiver`, the one page `<BookingWithWaiver>` runs on (SX-FR-02,
 * SX-FR-03): book → sign inline → receipt → confirmed (→ pay, Phase 4). Glue only: every rule lives
 * in a core, reached through its public routes in-process with the id the site configured.
 *
 * 1. Book (`intent=book`, the widget's post): Events `public/checkout/reserve`, then
 *    `public/checkout/continue` with the attendees. `done` goes to the booking page, `pay` to the
 *    provider. `sign` (an Events Pro waiver) redeems every intent with E-sign
 *    `public/envelopes/from-intent`: email signers are invited by E-sign (`draft` means the invitation
 *    is on its way, like `sent`), inline ones (the buyer, for self and as guardian for each minor)
 *    answer with a signing token. Those tokens go into an HttpOnly, SameSite=Strict cookie scoped to
 *    this page, never into a URL.
 * 2. Sign (GET, then the ceremony's own form posts): the first token's `<SigningCeremony>`, run by
 *    E-sign's `handleSign`. When a ceremony ends, its receipt (the fragment of `ceremonyRedirect(view)`,
 *    protocol §8.2) is forwarded in-process to Events `signatures/receipt` by Events' `forwardReceipt`,
 *    so no JavaScript is needed to carry it. The next signer follows; after the last (or a decline)
 *    the browser lands on `/booking?ref=…&waiver=…`, where Events shows the confirmed booking.
 *
 * Web APIs only, no `@semics-tech/shared` (R35).
 */
import { ceremonyRedirect, handleSign, type SignView } from "@semics-tech/emdash-esign/astro/lib/sign";
import { callPublicRoute, type PublicRouteContext } from "@semics-tech/emdash-events/astro/lib/call";
import {
	BOOKING_PATH,
	bookingCookieName,
	bookingCookieOptions,
	isCrossSiteRequest,
} from "@semics-tech/emdash-events/astro/lib/checkout-form";
import { isPayUrl } from "@semics-tech/emdash-events/astro/lib/payment";
import { forwardReceipt } from "@semics-tech/emdash-events/astro/lib/receipt";
import { newIdempotencyKey } from "@semics-tech/emdash-events/astro/lib/widget";

import {
	readWaiverForm,
	type SeatPart,
	safeReturnPath,
	seatField,
	WAIVER_PATH,
	type WaiverOrder,
	waiverErrorLocation,
} from "./form.ts";

/** The steps of the flow. `pay` is the Phase 4 slot: continue's `pay` answer is followed as it is. */
export const FLOW_STEPS = ["book", "sign", "pay", "done"] as const;

export interface SuiteIds {
	eventsPluginId: string;
	esignPluginId: string;
}

export interface WaiverRequestContext {
	locals: PublicRouteContext["locals"];
	url: URL;
	request: Request;
	/** Reads a request cookie (`(name) => Astro.cookies.get(name)?.value`). */
	cookie(name: string): string | undefined;
}

export interface CookieOp {
	name: string;
	value: string;
	options: Record<string, unknown>;
}

export type WaiverOutcome =
	| { type: "redirect"; location: string; cookies: CookieOp[] }
	/** Show `view` in `<SigningCeremony>`; `remaining` signers follow this one. */
	| { type: "render"; ref: string; token: string; remaining: number; view: SignView; cookies: CookieOp[] }
	| { type: "error"; code: string; ref?: string }
	| { type: "forbidden" };

export interface FlowDeps {
	/** Injected for tests: the idempotency key when the form carries none. */
	newKey?: () => string;
}

const BOOKING_REF = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const SIGNING_TOKEN = /^[A-Za-z0-9_-]{16,256}$/;
/** Keeps the cookie well under 4 KB (43-character tokens). */
const MAX_INLINE = 40;
/** The flow cookie outlives no hold (60 minutes at most, BUILD-PLAN §3.1). */
const FLOW_COOKIE_SECONDS = 60 * 60;
const ERROR_CODE = /^[A-Z_]{1,40}$/;
/** Waiver refusals of an order (Pro), shown with their own message rather than as BAD_REQUEST. */
const WAIVER_ISSUES = ["WAIVER_EMAIL_REQUIRED", "WAIVER_TOO_MANY_EMAILS"];

/** The cookie holding the inline signing tokens still to sign for booking `ref`. */
export const flowCookieName = (ref: string) => `semics_waiver_${ref}`;

/**
 * The booking's access token for "Try again" (T067). The booking cookie is scoped to `/booking`, so a
 * browser never sends it to this page; this copy lives on this page's path only, as long as the flow.
 */
export const retryCookieName = (ref: string) => `semics_waiver_access_${ref}`;

function retryCookie(url: URL, ref: string, accessToken: string | undefined): CookieOp {
	return {
		name: retryCookieName(ref),
		value: accessToken ?? "",
		options: {
			path: WAIVER_PATH,
			httpOnly: true,
			sameSite: "strict",
			secure: url.protocol === "https:",
			maxAge: accessToken ? FLOW_COOKIE_SECONDS : 0,
		},
	};
}

function flowCookie(url: URL, ref: string, tokens: readonly string[]): CookieOp {
	return {
		name: flowCookieName(ref),
		value: tokens.join("."),
		options: {
			path: WAIVER_PATH,
			httpOnly: true,
			sameSite: "strict",
			secure: url.protocol === "https:",
			maxAge: tokens.length > 0 ? FLOW_COOKIE_SECONDS : 0,
		},
	};
}

/**
 * Clears the retry cookie when the browser has one and the flow leaves this page (T119 F13): it is
 * needed only while this page still has signing or payment to start.
 */
const endRetry = (ctx: WaiverRequestContext, ref: string): CookieOp[] =>
	ctx.cookie(retryCookieName(ref)) ? [retryCookie(ctx.url, ref, undefined)] : [];

const redirect = (location: string, cookies: CookieOp[] = []): WaiverOutcome => ({
	type: "redirect",
	location,
	cookies,
});
const bookingPage = (ref: string) => `${BOOKING_PATH}?ref=${encodeURIComponent(ref)}`;

const post = <T>(ctx: PublicRouteContext, pluginId: string, path: string, body: unknown) =>
	callPublicRoute<T>(ctx, { method: "POST", path, pluginId, body });

/** Core issue paths as widget fields: the buyer's fields, and `attendees.<n>.…` as the row it came from. */
function fieldsOf(issues: ReadonlyArray<{ path?: unknown }> | undefined, order: WaiverOrder): string[] {
	const out = new Set<string>();
	for (const issue of issues ?? []) {
		const path = typeof issue.path === "string" ? issue.path : "";
		const attendee = /^attendees\.(\d+)\.(ticketTypeId|name|email)/.exec(path);
		const row = attendee ? order.rows[Number(attendee[1])] : undefined;
		if (attendee && row !== undefined) out.add(seatField(row, attendee[2] as SeatPart));
		else if (path.startsWith("attendees")) out.add("attendees");
		else if (path.startsWith("buyer.name")) out.add("name");
		else if (path.startsWith("buyer.email")) out.add("email");
		else if (path.startsWith("occurrenceId")) out.add("occurrence");
		else if (path.startsWith("lines")) out.add(order.rows.length > 0 ? "attendees" : "tickets");
	}
	return [...out];
}

interface Intent {
	ref?: unknown;
	delivery?: unknown;
	token?: unknown;
}

/** Redeems each intent with E-sign; the inline signing tokens, or `null` if any intent was refused. */
async function redeemIntents(
	ctx: PublicRouteContext,
	ids: SuiteIds,
	intents: readonly Intent[],
): Promise<string[] | null> {
	const inline: string[] = [];
	for (const intent of intents) {
		const result = await post<{ status?: unknown; signingToken?: unknown }>(
			ctx,
			ids.esignPluginId,
			"public/envelopes/from-intent",
			{ intent: intent.token },
		);
		if (!result.ok) return null;
		const { status, signingToken } = result.data;
		if (intent.delivery === "email") {
			// `draft`: accepted, the invitation is being finished by a one-shot task (protocol §8.1).
			if (status === "draft" || status === "sent" || status === "in_progress" || status === "completed") continue;
			return null;
		}
		if (typeof signingToken === "string" && SIGNING_TOKEN.test(signingToken)) inline.push(signingToken);
		else if (status !== "completed") return null;
	}
	return inline;
}

async function book(ctx: WaiverRequestContext, form: FormData, ids: SuiteIds, deps: FlowDeps): Promise<WaiverOutcome> {
	const call = { locals: ctx.locals, url: ctx.url, request: ctx.request };
	const eventId = (form.get("eventId") ?? "").toString().trim();
	const returnTo = safeReturnPath((form.get("returnTo") ?? "").toString(), ctx.url.origin);
	const refuse = (code: string, fields: string[] = []) =>
		redirect(
			returnTo && eventId
				? waiverErrorLocation(returnTo, eventId, code, fields)
				: `${BOOKING_PATH}?error=${encodeURIComponent(code)}`,
		);

	const read = readWaiverForm(form);
	if (!read.ok) return refuse(read.code, read.fields);
	const order = read.order;

	const reserved = await post<{ bookingRef?: string; accessToken?: string }>(
		call,
		ids.eventsPluginId,
		"public/checkout/reserve",
		{
			eventId: order.eventId,
			...(order.occurrenceId ? { occurrenceId: order.occurrenceId } : {}),
			lines: order.lines,
			buyer: order.buyer,
			idempotencyKey: order.idempotencyKey || (deps.newKey ?? newIdempotencyKey)(),
			...(order.turnstileToken ? { turnstileToken: order.turnstileToken } : {}),
		},
	);
	if (!reserved.ok) return refuse(reserved.error.code, fieldsOf(reserved.error.issues, order));
	const ref = reserved.data.bookingRef ?? "";
	const accessToken = reserved.data.accessToken;
	if (!BOOKING_REF.test(ref)) return refuse("INTERNAL");
	// A resubmit of a booking already confirmed gets no new token: this browser has its cookie.
	if (!accessToken) return redirect(bookingPage(ref));
	const cookies: CookieOp[] = [
		{ name: bookingCookieName(ref), value: accessToken, options: bookingCookieOptions(ctx.url) },
	];

	const continued = await post<{ next?: { type?: unknown; url?: unknown; intents?: unknown } }>(
		call,
		ids.eventsPluginId,
		"public/checkout/continue",
		// An event with no waiver is booked without attendee rows: Events plans the seats itself.
		{ bookingRef: ref, accessToken, ...(order.attendees.length > 0 ? { attendees: order.attendees } : {}) },
	);
	if (!continued.ok) {
		// Nothing to sign or pay for yet: release the held seats so a corrected order can have them.
		await post(call, ids.eventsPluginId, "public/booking/cancel", { bookingRef: ref, accessToken });
		const { code, issues } = continued.error;
		const waiverIssue = issues?.find((i) => WAIVER_ISSUES.includes(i.code));
		return refuse(waiverIssue ? waiverIssue.code : code, fieldsOf(issues, order));
	}

	return proceed(ctx, ids, ref, continued.data.next, cookies, accessToken);
}

/** Follows continue's `next`: the provider, the booking page, or the signing step. */
async function proceed(
	ctx: WaiverRequestContext,
	ids: SuiteIds,
	ref: string,
	next: { type?: unknown; url?: unknown; intents?: unknown } | undefined,
	cookies: CookieOp[],
	accessToken: string,
): Promise<WaiverOutcome> {
	const leave = [...cookies, ...endRetry(ctx, ref)];
	if (next?.type === "pay") {
		return isPayUrl(next.url) ? redirect(next.url, leave) : redirect(`${bookingPage(ref)}&error=PAYMENT_FAILED`, leave);
	}
	if (next?.type !== "sign" || !Array.isArray(next.intents)) return redirect(bookingPage(ref), leave);

	const call = { locals: ctx.locals, url: ctx.url, request: ctx.request };
	const inline = await redeemIntents(call, ids, next.intents as Intent[]);
	// E-sign refused an intent: the booking stays held, and the page offers a retry (below), which
	// needs the booking's access token on this page's path.
	if (inline === null) {
		return redirect(`${WAIVER_PATH}?ref=${ref}&error=SIGNING_UNAVAILABLE`, [
			...cookies,
			retryCookie(ctx.url, ref, accessToken),
		]);
	}
	if (inline.length === 0) return redirect(bookingPage(ref), leave);
	// The token stays on this page's path for the retry button and for payment after the last receipt.
	return redirect(`${WAIVER_PATH}?ref=${ref}`, [
		...cookies,
		retryCookie(ctx.url, ref, accessToken),
		flowCookie(ctx.url, ref, inline.slice(0, MAX_INLINE)),
	]);
}

/**
 * "Try again" after e-sign refused an intent (T066): continues the held booking once more with its
 * booking cookie. No attendees are sent: Events keeps the stored ones, and Pro issues intents only for
 * the seats that have not signed. A lapsed hold or a refusal comes back as an error on this page.
 */
async function retry(ctx: WaiverRequestContext, ids: SuiteIds): Promise<WaiverOutcome> {
	const ref = ctx.url.searchParams.get("ref") ?? "";
	if (!BOOKING_REF.test(ref)) return redirect(BOOKING_PATH);
	const accessToken = ctx.cookie(retryCookieName(ref)) || ctx.cookie(bookingCookieName(ref));
	if (!accessToken) return redirect(bookingPage(ref));
	const call = { locals: ctx.locals, url: ctx.url, request: ctx.request };
	const continued = await post<{ next?: { type?: unknown; url?: unknown; intents?: unknown } }>(
		call,
		ids.eventsPluginId,
		"public/checkout/continue",
		{ bookingRef: ref, accessToken },
	);
	if (!continued.ok) {
		const code = ERROR_CODE.test(continued.error.code) ? continued.error.code : "INTERNAL";
		return redirect(`${WAIVER_PATH}?ref=${ref}&error=${code}`);
	}
	return proceed(ctx, ids, ref, continued.data.next, [], accessToken);
}

/** The receipt a finished ceremony hands back (the fragment of `ceremonyRedirect(view)`, §8.2). */
function receiptOf(view: SignView): string | undefined {
	const back = ceremonyRedirect(view) ?? (view.kind === "closed" ? view.returnUrl : undefined);
	const hash = back ? new URL(back).hash : "";
	return hash.startsWith("#receipt=") ? hash.slice("#receipt=".length) : undefined;
}

/**
 * After the last receipt of a paid waiver booking the booking waits at `awaiting_payment` with no
 * payment link (T065, T073): ask Events to continue it again (no attendees: it keeps the signed ones)
 * and follow the `pay` step. Anything else (free, other signers pending, a lapsed hold, no cookie)
 * keeps the booking page, which shows the booking as it is, with "Pay now" if it needs it.
 */
async function payOrLand(ctx: WaiverRequestContext, ids: SuiteIds, ref: string, landed: string): Promise<string> {
	if (!landed.includes("waiver=signed")) return landed;
	const accessToken = ctx.cookie(retryCookieName(ref)) || ctx.cookie(bookingCookieName(ref));
	if (!accessToken) return landed;
	const call = { locals: ctx.locals, url: ctx.url, request: ctx.request };
	const continued = await post<{ next?: { type?: unknown; url?: unknown } }>(
		call,
		ids.eventsPluginId,
		"public/checkout/continue",
		{ bookingRef: ref, accessToken },
	);
	const next = continued.ok ? continued.data.next : undefined;
	return next?.type === "pay" && isPayUrl(next.url) ? next.url : landed;
}

async function sign(ctx: WaiverRequestContext, ids: SuiteIds, form: FormData | null): Promise<WaiverOutcome> {
	const ref = ctx.url.searchParams.get("ref") ?? "";
	if (!BOOKING_REF.test(ref)) return redirect(BOOKING_PATH);
	const error = ctx.url.searchParams.get("error");
	if (!form && error) return { type: "error", ref, code: ERROR_CODE.test(error) ? error : "INTERNAL" };

	const tokens = (ctx.cookie(flowCookieName(ref)) ?? "").split(".").filter(Boolean);
	if (tokens.length === 0 || !tokens.every((t) => SIGNING_TOKEN.test(t))) {
		return redirect(bookingPage(ref), tokens.length ? [flowCookie(ctx.url, ref, [])] : []);
	}
	const call = { locals: ctx.locals, url: ctx.url, request: ctx.request };
	const signCtx = { ...call, pluginId: ids.esignPluginId };
	const forward = (receipt: string) =>
		forwardReceipt(call, { ref, receipt }, { pluginId: ids.eventsPluginId, esignPluginId: ids.esignPluginId });

	let rest = tokens;
	if (form) {
		const [token = "", ...after] = rest;
		const view = await handleSign(signCtx, token, form);
		if (view.kind === "ready" || view.kind === "error") {
			return { type: "render", ref, token, remaining: after.length, view, cookies: [] };
		}
		// Signed, declined, or closed meanwhile (another tab): record the outcome with Events.
		const receipt = receiptOf(view);
		const landed = receipt ? (await forward(receipt)).location : bookingPage(ref);
		if (view.kind === "declined") return redirect(landed, [flowCookie(ctx.url, ref, []), ...endRetry(ctx, ref)]);
		if (after.length === 0)
			return redirect(await payOrLand(ctx, ids, ref, landed), [
				flowCookie(ctx.url, ref, []),
				retryCookie(ctx.url, ref, undefined),
			]);
		return redirect(`${WAIVER_PATH}?ref=${ref}`, [flowCookie(ctx.url, ref, after)]);
	}

	// A GET only looks. An envelope closed meanwhile (signed in another tab) is forwarded and skipped.
	let landed = bookingPage(ref);
	while (rest.length > 0) {
		const [token = "", ...after] = rest;
		const view = await handleSign(signCtx, token, null);
		if (view.kind !== "closed") {
			const cookies = rest.length === tokens.length ? [] : [flowCookie(ctx.url, ref, rest)];
			return { type: "render", ref, token, remaining: after.length, view, cookies };
		}
		const receipt = receiptOf(view);
		if (receipt) landed = (await forward(receipt)).location;
		rest = after;
	}
	return redirect(await payOrLand(ctx, ids, ref, landed), [
		flowCookie(ctx.url, ref, []),
		retryCookie(ctx.url, ref, undefined),
	]);
}

/** Everything `/_events/waiver` does for one request. The page applies cookies and redirects. */
export async function handleWaiverRequest(
	ctx: WaiverRequestContext,
	ids: SuiteIds,
	deps: FlowDeps = {},
): Promise<WaiverOutcome> {
	// Every post here is a form post: refuse one another site made (CSRF, as the Events pages do).
	if (isCrossSiteRequest(ctx.request, ctx.url)) return { type: "forbidden" };
	const form = ctx.request.method === "POST" ? await ctx.request.formData().catch(() => new FormData()) : null;
	if (form?.get("intent") === "book") return book(ctx, form, ids, deps);
	if (form?.get("intent") === "retry") return retry(ctx, ids);
	return sign(ctx, ids, form);
}
