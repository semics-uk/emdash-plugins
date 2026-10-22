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

export interface ReconcileInput {
	booking: Pick<BookingView, "bookingRef" | "waiver">;
	/** The Events core's plugin id. */
	pluginId: string;
	/** The E-sign core's plugin id. */
	esignPluginId: string;
}

/** A page load asks e-sign at most this many times (the core lists no more refs than this). */
const MAX_LOOKUPS = 10;
/** `payloadB64 "." signature` (§4). */
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const LOOKUP_MAX = 1024;
const RECEIPT_MAX = 2048;

const tokenOf = (value: unknown, max: number): string | null =>
	typeof value === "string" && value.length <= max && TOKEN.test(value) ? value : null;

/** Forwards the receipts e-sign already holds for the booking's unsigned refs; resolves with how many Events took. */
export async function reconcileBooking(ctx: PublicRouteContext, input: ReconcileInput): Promise<{ forwarded: number }> {
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
