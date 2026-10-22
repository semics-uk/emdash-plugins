import { callPublicRoute, type PublicRouteContext } from "./call";
import { isPayUrl } from "./payment";
import {
	fieldsFromIssues,
	newIdempotencyKey,
	promoRefusal,
	safeReturnTo,
	validateCheckoutFields,
	type WidgetField,
	widgetErrorLocation,
} from "./widget";

export interface CheckoutFormOptions {
	/** The core's plugin id. Defaults to the slug; registry installs pass their `r_…` id. */
	pluginId?: string;
	/** Injected for tests: makes the idempotency key when the form carries none. */
	newKey?: () => string;
}

export interface CheckoutRedirect {
	location: string;
	/** The booking's access token, for an HttpOnly cookie scoped to `/booking`. Never in a URL. */
	cookie?: { name: string; value: string };
}

export const BOOKING_PATH = "/booking";
/** Where the booking widget's form posts (injected by `eventsIntegration`). */
export const CHECKOUT_PATH = "/_events/checkout";
export const bookingCookieName = (ref: string) => `semics_booking_${ref}`;

export const QTY_PREFIX = "qty:";

/** The booking cookie: HttpOnly, scoped to the booking page, 30 days. */
export function bookingCookieOptions(url: URL) {
	return {
		path: BOOKING_PATH,
		httpOnly: true,
		sameSite: "lax" as const,
		secure: url.protocol === "https:",
		maxAge: 60 * 60 * 24 * 30,
	};
}

/**
 * True for a form post another site made (CSRF): the browser says so in `Sec-Fetch-Site`, or, from
 * older browsers, an `Origin` that is not this site's. The booking forms check this themselves so
 * they stay safe on a site that turns off Astro's `security.checkOrigin`; the SameSite=Lax cookie
 * alone would still let another site start bookings in a visitor's name. Safe methods and clients
 * that send neither header (not browsers) pass.
 */
export function isCrossSiteRequest(request: Request, url: URL): boolean {
	if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return false;
	const site = request.headers.get("sec-fetch-site");
	if (site) return site !== "same-origin" && site !== "none";
	const origin = request.headers.get("origin");
	if (origin === null || origin === url.origin) return false;
	// Astro builds `url` from `localhost` unless the host is in `security.allowedDomains`; the Host
	// the browser sent is the site it posted to, and another site cannot set it.
	try {
		return new URL(origin).host !== request.headers.get("host");
	} catch {
		return true;
	}
}

/** The answer to a refused cross-site post. */
export const crossSiteResponse = () =>
	new Response("Cross-site form submissions are not allowed.", {
		status: 403,
		headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
	});

const REF_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;
/** What the booking page shows for an emailed link that is malformed, expired or already used. */
export const LINK_INVALID = "LINK_INVALID";

/**
 * The emailed link (`/booking?ref=&k=<one-time code>`, R34): only ever called from the booking
 * page's POST (its "Open my booking" button), never on GET, so a mail scanner that prefetches the
 * link cannot use up the code. Swaps the code for a fresh access token through
 * `public/booking/redeem` and lands on `/booking?ref=` without `k`, the token in the cookie.
 */
export async function redeemBookingLink(
	ctx: PublicRouteContext,
	link: { ref: string; code: string },
	options: Pick<CheckoutFormOptions, "pluginId">,
): Promise<CheckoutRedirect> {
	if (!REF_PATTERN.test(link.ref)) return fail(LINK_INVALID);
	if (!link.code) return fail(LINK_INVALID, link.ref);
	const redeemed = await callPublicRoute<{ bookingRef: string; accessToken: string }>(ctx, {
		method: "POST",
		path: "public/booking/redeem",
		pluginId: options.pluginId,
		body: { bookingRef: link.ref, code: link.code },
	});
	if (!redeemed.ok || !redeemed.data.accessToken) return fail(LINK_INVALID, link.ref);
	return {
		location: `${BOOKING_PATH}?ref=${encodeURIComponent(link.ref)}`,
		cookie: { name: bookingCookieName(link.ref), value: redeemed.data.accessToken },
	};
}

function text(form: FormData, key: string): string {
	const value = form.get(key);
	return typeof value === "string" ? value.trim() : "";
}

function fail(code: string, ref?: string, cookie?: CheckoutRedirect["cookie"]): CheckoutRedirect {
	const query = new URLSearchParams();
	if (ref) query.set("ref", ref);
	query.set("error", code);
	return { location: `${BOOKING_PATH}?${query}`, ...(cookie ? { cookie } : {}) };
}

/**
 * The no-JS checkout (`POST /_events/checkout`): reserve, then continue, through the public routes
 * only. The access token goes back as a cookie value, never in the redirect URL.
 *
 * A form from the booking widget carries `returnTo` (its own page): anything refused before a
 * booking exists goes back there with the error code and the names of the fields to fix, never
 * the values typed. Without a usable `returnTo`, refusals land on the booking page as before.
 */
export async function handleCheckoutForm(
	ctx: PublicRouteContext,
	form: FormData,
	options: CheckoutFormOptions,
): Promise<CheckoutRedirect> {
	const pluginId = options.pluginId;
	const lines: Array<{ ticketTypeId: string; qty: number }> = [];
	for (const [key, value] of form.entries()) {
		if (!key.startsWith(QTY_PREFIX) || typeof value !== "string") continue;
		const qty = Number.parseInt(value, 10);
		if (qty > 0) lines.push({ ticketTypeId: key.slice(QTY_PREFIX.length), qty });
	}
	const eventId = text(form, "eventId");
	const returnTo = safeReturnTo(text(form, "returnTo"), ctx.url.origin);
	const refuse = (code: string, fields: WidgetField[] = []) =>
		returnTo && eventId ? { location: widgetErrorLocation(returnTo, eventId, code, fields) } : fail(code);
	if (!eventId) return fail("BAD_REQUEST");

	const occurrenceId = text(form, "occurrenceId");
	const buyer = { name: text(form, "name"), email: text(form, "email") };
	const invalid = validateCheckoutFields({
		...buyer,
		lines: lines.length,
		needsOccurrence: form.get("needsOccurrence") === "1",
		occurrenceId,
	});
	if (invalid.length > 0) return refuse("BAD_REQUEST", invalid);

	const turnstileToken = text(form, "cf-turnstile-response");
	// Only a typed code is sent: Free's reserve refuses unknown keys, and only Pro offers the field.
	const promoCode = text(form, "promoCode");
	const reserved = await callPublicRoute<{ bookingRef: string; accessToken?: string }>(ctx, {
		method: "POST",
		path: "public/checkout/reserve",
		pluginId,
		body: {
			eventId,
			...(occurrenceId ? { occurrenceId } : {}),
			lines,
			buyer,
			idempotencyKey: text(form, "idempotencyKey") || (options.newKey ?? newIdempotencyKey)(),
			...(turnstileToken ? { turnstileToken } : {}),
			...(promoCode ? { promoCode } : {}),
		},
	});
	if (!reserved.ok) {
		const { issues } = reserved.error;
		const code = promoCode ? promoRefusal(reserved.error.code) : reserved.error.code;
		const fields: WidgetField[] = code.startsWith("PROMO_") ? ["promo"] : [];
		return refuse(code, code === "BAD_REQUEST" ? fieldsFromIssues(issues) : fields);
	}

	const { bookingRef, accessToken } = reserved.data;
	const done = `${BOOKING_PATH}?ref=${encodeURIComponent(bookingRef)}`;
	// A resubmit of a booking that is already confirmed gets no new token: this browser has its cookie.
	if (!accessToken) return { location: done };
	const cookie = { name: bookingCookieName(bookingRef), value: accessToken };
	const next = await callPublicRoute<{ next?: { type?: string; url?: string } }>(ctx, {
		method: "POST",
		path: "public/checkout/continue",
		pluginId,
		body: { bookingRef, accessToken },
	});
	if (!next.ok) return fail(next.error.code, bookingRef, cookie);

	const step = next.data.next;
	if (step?.type === "pay")
		return isPayUrl(step.url) ? { location: step.url, cookie } : fail("PAYMENT_FAILED", bookingRef, cookie);
	return { location: done, cookie };
}

/**
 * "Pay now" on the booking page (EU-FR-09): continues the held or awaiting-payment booking again
 * with the cookie's token (Events Pro answers with the payment page again, or a new one) and follows
 * the `pay` step. Anything else lands on the booking page, which shows the booking as it is.
 */
export async function resumePayment(
	ctx: PublicRouteContext,
	input: { ref: string; token: string },
	options: Pick<CheckoutFormOptions, "pluginId">,
): Promise<{ location: string }> {
	if (!REF_PATTERN.test(input.ref)) return { location: BOOKING_PATH };
	const page = `${BOOKING_PATH}?ref=${encodeURIComponent(input.ref)}`;
	if (!input.token) return { location: page };
	const next = await callPublicRoute<{ next?: { type?: string; url?: unknown } }>(ctx, {
		method: "POST",
		path: "public/checkout/continue",
		pluginId: options.pluginId,
		body: { bookingRef: input.ref, accessToken: input.token },
	});
	if (!next.ok) return fail(next.error.code, input.ref);
	const step = next.data.next;
	if (step?.type === "pay") return isPayUrl(step.url) ? { location: step.url } : fail("PAYMENT_FAILED", input.ref);
	return { location: page };
}

/** What `POST /_events/checkout` gets from Astro. */
export interface CheckoutEndpointContext {
	request: Request;
	url: URL;
	locals: PublicRouteContext["locals"];
	redirect(location: string, status?: number): Response;
	cookies: { set(name: string, value: string, options: Record<string, unknown>): void };
}

/** `POST /_events/checkout`: refuse cross-site posts, then run the form and redirect (303). */
export async function handleCheckoutRequest(
	{ request, url, locals, redirect, cookies }: CheckoutEndpointContext,
	options: CheckoutFormOptions,
): Promise<Response> {
	if (isCrossSiteRequest(request, url)) return crossSiteResponse();
	const form = await request.formData().catch(() => new FormData());
	const result = await handleCheckoutForm({ locals, url, request }, form, options);
	if (result.cookie) cookies.set(result.cookie.name, result.cookie.value, bookingCookieOptions(url));
	return redirect(result.location, 303);
}
