/**
 * Closed-tab reconciliation for a booking that waits for signatures (SX-FR-05; esign-intent/1 §8.3).
 * A signer may have finished without Events hearing of it: they closed the tab before the receipt
 * redirect, or they sign by email and never come back here. When the booking page loads, the Events
 * core lists the refs still unsigned and (Pro) a signed lookup request for each, minted where the
 * pairing secret lives. This asks e-sign's `public/receipts/lookup` for each request and forwards every
 * terminal receipt to Events with Events' own `forwardReceipt`. Events stores a receipt once and never
 * replaces a completed one, so forwarding the same receipt again changes nothing.
 *
 * Glue only: no storage, no tokens minted, no judgement about what a receipt means. The Free core
 * lists no requests, so nothing happens there. Every failure is swallowed: the status page must render.
 * Web APIs only, no `@semics-tech/shared` (R35).
 */
import { callPublicRoute, type PublicRouteContext } from "@semics-tech/emdash-events/astro/lib/call";
import { forwardReceipt } from "@semics-tech/emdash-events/astro/lib/receipt";
import type { BookingView } from "@semics-tech/emdash-events/astro/lib/widget";
import { settleVoucher } from "./voucher.ts";

export interface ReconcileInput {
	booking: Pick<BookingView, "bookingRef" | "waiver" | "voucher">;
	/** The Events core's plugin id. */
	pluginId: string;
	/** The E-sign core's plugin id. */
	esignPluginId: string;
	/** The Vouchers core's plugin id, when the site has one (T166). */
	vouchersPluginId?: string;
}

/** A page load asks e-sign at most this many times (the core lists no more refs than this). */
const MAX_LOOKUPS = 10;
/** `payloadB64 "." signature` (§4). */
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const LOOKUP_MAX = 1024;
const RECEIPT_MAX = 2048;

const tokenOf = (value: unknown, max: number): string | null =>
	typeof value === "string" && value.length <= max && TOKEN.test(value) ? value : null;

const INTENT_MAX = 4096;

/**
 * T152: an ended booking (expired, cancelled) carries, with Pro, a `replace` intent per seat not signed.
 * Each goes to e-sign's `from-intent`, which voids the seat's open envelope and creates nothing, so a
 * signing token lifted from the waiver cookie signs nothing any more. Idempotent (a voided or completed
 * envelope is left alone), so every visit may send them again. Resolves with how many e-sign accepted.
 */
export async function voidEnvelopes(
	ctx: PublicRouteContext,
	input: Pick<ReconcileInput, "booking" | "esignPluginId">,
): Promise<number> {
	const intents = Object.values(input.booking.waiver?.voids ?? {})
		.slice(0, MAX_LOOKUPS)
		.map((intent) => tokenOf(intent, INTENT_MAX))
		.filter((token): token is string => token !== null);
	const answers = await Promise.all(
		intents.map((intent) =>
			callPublicRoute(ctx, {
				method: "POST",
				path: "public/envelopes/from-intent",
				pluginId: input.esignPluginId,
				body: { intent },
			}).catch(() => null),
		),
	);
	return answers.filter((a) => a?.ok).length;
}

/** Forwards the receipts e-sign already holds for the booking's unsigned refs; resolves with how many Events took. */
export async function reconcileBooking(
	ctx: PublicRouteContext,
	input: ReconcileInput,
): Promise<{ forwarded: number; voided?: number; settled?: number }> {
	// T166: Events Pro answers a gift voucher hold's outcome (confirmed, released, credited); Vouchers applies it
	// idempotently, so every visit may send it again. Then whatever the waiver needs.
	const settle = input.booking.voucher?.settle;
	if (settle && input.vouchersPluginId) {
		const settled = (await settleVoucher(ctx, settle, input.vouchersPluginId)) ? 1 : 0;
		const rest = input.booking.waiver ? await reconcileWaiver(ctx, input) : { forwarded: 0 };
		return { ...rest, settled };
	}
	return reconcileWaiver(ctx, input);
}

async function reconcileWaiver(
	ctx: PublicRouteContext,
	input: ReconcileInput,
): Promise<{ forwarded: number; voided?: number }> {
	if (input.booking.waiver?.voids) return { forwarded: 0, voided: await voidEnvelopes(ctx, input) };
	const { refs = [], lookups = {} } = input.booking.waiver ?? {};
	const requests = refs
		.slice(0, MAX_LOOKUPS)
		.map((ref) => tokenOf(lookups[ref], LOOKUP_MAX))
		.filter((token): token is string => token !== null);
	const answers = await Promise.all(
		requests.map((request) =>
			callPublicRoute<{ state?: unknown; receipt?: unknown }>(ctx, {
				method: "POST",
				path: "public/receipts/lookup",
				pluginId: input.esignPluginId,
				body: { request },
			}).catch(() => null),
		),
	);
	let forwarded = 0;
	for (const answer of answers) {
		if (!answer?.ok || answer.data.state !== "terminal") continue;
		const receipt = tokenOf(answer.data.receipt, RECEIPT_MAX);
		if (receipt === null) continue;
		const done = await forwardReceipt(
			ctx,
			{ ref: input.booking.bookingRef, receipt },
			{ pluginId: input.pluginId, esignPluginId: input.esignPluginId },
		).catch(() => null);
		if (done && !done.location.includes("waiver=failed")) forwarded += 1;
	}
	return { forwarded };
}
