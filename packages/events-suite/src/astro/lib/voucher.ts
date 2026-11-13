/**
 * Gift vouchers in the booking flow (T163 §6; protocol voucher/1 §8): glue between Events and Vouchers,
 * which cannot call each other. Everything runs in process on the server, so no JavaScript is needed.
 *
 * `holdVoucher`, between Events' reserve and continue:
 * 1. Events `public/booking` (with the access token reserve just gave): the booking's ref, event, lines with
 *    their unit prices and the amount due after any promo code. These come from Events, never the browser.
 * 2. Vouchers `public/redeem/hold` with the code and those. The visitor's IP headers go along
 *    (`callPublicRoute`), so Vouchers' per-IP limit sees visitors rather than one shared bucket.
 * 3. `VOUCHER_NO_BALANCE` while other holds are open carries `lookups`: each goes to Events
 *    `public/voucher/lookup`, every settle token it answers to Vouchers `public/redeem/settle` (an abandoned
 *    checkout frees its balance), then the hold is asked for once more.
 * The answer is the `voucher-hold/1` token the suite hands to Events' continue, or the refusal's code.
 *
 * `settleVoucher` passes a `voucher-settle/1` token Events minted (booking page) to Vouchers.
 *
 * Tokens are opaque here: the cores sign and verify them. Web APIs only, no `@semics-tech/shared` (R35).
 */
import { callPublicRoute, type PublicRouteContext } from "@semics-tech/emdash-events/astro/lib/call";

export interface VoucherIds {
	eventsPluginId: string;
	vouchersPluginId: string;
}

export type VoucherHoldResult = { ok: true; hold: string } | { ok: false; code: string };

/** `payloadB64 "." signature` (voucher/1 §4), at most 1024 characters. */
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const isToken = (v: unknown): v is string => typeof v === "string" && v.length <= 1024 && TOKEN.test(v);
/** Vouchers answers at most five lookups (§8.1). */
const MAX_LOOKUPS = 5;
/** Codes passed on as they are; anything else (a missing plugin, a crash) is "vouchers unavailable". */
const PASSED = [
	"VOUCHER_INVALID",
	"VOUCHER_NO_BALANCE",
	"VOUCHER_WRONG_ACTIVITY",
	"VOUCHER_CURRENCY",
	"VOUCHER_UNAVAILABLE",
	"RATE_LIMITED",
];
const UNAVAILABLE: VoucherHoldResult = { ok: false, code: "VOUCHER_UNAVAILABLE" };

interface BookingLines {
	bookingRef?: string;
	eventId?: string;
	lines?: Array<{ ticketTypeId?: string; qty?: number; unitPriceMinor?: number }>;
	totals?: { totalMinor?: number; currency?: string };
}

const post = <T>(ctx: PublicRouteContext, pluginId: string, path: string, body: unknown) =>
	callPublicRoute<T>(ctx, { method: "POST", path, pluginId, body });

/** Passes a settle token to Vouchers; true when it took it. */
export async function settleVoucher(ctx: PublicRouteContext, settle: unknown, vouchersPluginId: string) {
	if (!isToken(settle)) return false;
	const done = await post(ctx, vouchersPluginId, "public/redeem/settle", { settle }).catch(() => null);
	return done?.ok === true;
}

/** Asks Events for each open hold's outcome and settles the ones it knows (voucher/1 §8.3). */
async function settleLookups(ctx: PublicRouteContext, ids: VoucherIds, lookups: unknown): Promise<void> {
	const requests = (Array.isArray(lookups) ? lookups : []).filter(isToken).slice(0, MAX_LOOKUPS);
	const answers = await Promise.all(
		requests.map((request) =>
			post<{ settle?: unknown }>(ctx, ids.eventsPluginId, "public/voucher/lookup", { request }).catch(() => null),
		),
	);
	for (const answer of answers) {
		if (answer?.ok) await settleVoucher(ctx, answer.data.settle, ids.vouchersPluginId);
	}
}

export type VoucherCheckResult = { ok: true } | { ok: false; code: string };

/**
 * T168 (from T166): asks Vouchers `public/redeem/check` before Events reserves anything, with the code and the
 * order's ticket types, so a mistyped, expired or spent code is refused on the form: no booking held and then
 * cancelled, so no "cancelled" email. Moves nothing; the hold after reserve still decides. A Vouchers without the
 * route, or one that fails, never blocks the booking (the hold refuses as before).
 */
export async function checkVoucher(
	ctx: PublicRouteContext,
	input: { code: string; eventId: string; ticketTypeIds: string[] },
	ids: Pick<VoucherIds, "vouchersPluginId">,
): Promise<VoucherCheckResult> {
	if (input.code.length > 64) return { ok: false, code: "VOUCHER_INVALID" };
	const lines = input.ticketTypeIds.map((ticketTypeId) => ({ eventId: input.eventId, ticketTypeId }));
	const out = await post(ctx, ids.vouchersPluginId, "public/redeem/check", { code: input.code, lines }).catch(
		() => null,
	);
	const code = out && !out.ok ? out.error.code : "";
	return PASSED.includes(code) ? { ok: false, code } : { ok: true };
}

export async function holdVoucher(
	ctx: PublicRouteContext,
	input: { code: string; bookingRef: string; accessToken: string },
	ids: VoucherIds,
): Promise<VoucherHoldResult> {
	// The protocol's normalisation refuses anything longer (§7): no need to ask anyone.
	if (input.code.length > 64) return { ok: false, code: "VOUCHER_INVALID" };
	const read = await post<BookingLines>(ctx, ids.eventsPluginId, "public/booking", {
		bookingRef: input.bookingRef,
		accessToken: input.accessToken,
	}).catch(() => null);
	if (!read?.ok) return UNAVAILABLE;
	const b = read.data;
	const request = {
		code: input.code,
		ref: b.bookingRef ?? input.bookingRef,
		dueMinor: b.totals?.totalMinor,
		currency: b.totals?.currency,
		lines: (b.lines ?? []).map((l) => ({
			eventId: b.eventId,
			ticketTypeId: l.ticketTypeId,
			unitMinor: l.unitPriceMinor,
			qty: l.qty,
		})),
	};
	for (let attempt = 0; ; attempt++) {
		const held = await post<{ hold?: unknown }>(ctx, ids.vouchersPluginId, "public/redeem/hold", request).catch(
			() => null,
		);
		if (held?.ok) return isToken(held.data.hold) ? { ok: true, hold: held.data.hold } : UNAVAILABLE;
		const code = held?.error.code ?? "";
		const lookups = held?.error.details?.lookups;
		if (code === "VOUCHER_NO_BALANCE" && attempt === 0 && Array.isArray(lookups) && lookups.length > 0) {
			await settleLookups(ctx, ids, lookups);
			continue;
		}
		return PASSED.includes(code) ? { ok: false, code } : UNAVAILABLE;
	}
}
