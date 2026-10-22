/**
 * Server side of the waiver return page and door signing (EV-FR-12, SX-FR-04; esign-intent/1 §8.2,
 * §8.3). Tokens arrive in POST bodies only (moved from the URL fragment by `src/client/receipt.ts`)
 * and go to the cores in POST bodies; redirects never carry them.
 *
 * - `forwardReceipt`: POSTs a receipt to the Events core's `signatures/receipt`. When the receipt's
 *   `pdfSha256` was still null, the core adds a `lookup` request; with the e-sign core's plugin id
 *   configured, this asks e-sign's `public/receipts/lookup` once and forwards the full receipt.
 *   (Closed-tab reconciliation on later visits is the suite's job, T066.)
 * - `startDoorSigning`: redeems a staff-issued intent (check-in's signing link) with e-sign's
 *   `public/envelopes/from-intent` in-process and sends the browser to e-sign's signing page. When the
 *   envelope is already completed (an emailed adult signed, but their return page never posted the
 *   receipt: no JavaScript, tab closed), the link's lookup request (Pro mints it with the intent) fetches
 *   the receipt from e-sign and records it, so check-in admits them (T119 F5).
 *
 * Web APIs only, no `@semics-tech/shared` (R35).
 */
import { callPublicRoute, type PublicRouteContext } from "./call";
import { BOOKING_PATH } from "./checkout-form";

export interface ReceiptOptions {
	/** The Events core's plugin id (defaults to the slug). */
	pluginId?: string;
	/** The e-sign core's plugin id, when e-sign runs on this site (`eventsIntegration({ esignPluginId })`). */
	esignPluginId?: string | null;
}

/** `payloadB64 "." signature` (§4), within a type's maximum length. */
const tokenOk = (value: unknown, max: number): value is string =>
	typeof value === "string" && value.length <= max && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value);

const BOOKING_REF = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const RECEIPT_MAX = 2048;
const INTENT_MAX = 8192;

/** The notice the booking page shows for `?waiver=`. */
export type WaiverNotice = "signed" | "declined" | "voided" | "expired" | "failed";

interface ReceiptAnswer {
	status?: string;
	signature?: { status?: string };
	lookup?: unknown;
}

function bookingLocation(ref: string, notice: WaiverNotice): string {
	const query = new URLSearchParams();
	if (BOOKING_REF.test(ref)) query.set("ref", ref);
	query.set("waiver", notice);
	return `${BOOKING_PATH}?${query}`;
}

const post = <T>(ctx: PublicRouteContext, pluginId: string | undefined, path: string, body: unknown) =>
	callPublicRoute<T>(ctx, { method: "POST", path, body, ...(pluginId ? { pluginId } : {}) });

/** Forward a receipt from the return page; answers with where to send the browser. */
export async function forwardReceipt(
	ctx: PublicRouteContext,
	input: { ref: string; receipt: unknown },
	options: ReceiptOptions,
): Promise<{ location: string }> {
	if (!tokenOk(input.receipt, RECEIPT_MAX)) return { location: bookingLocation(input.ref, "failed") };
	const result = await post<ReceiptAnswer>(ctx, options.pluginId, "signatures/receipt", { receipt: input.receipt });
	if (!result.ok) return { location: bookingLocation(input.ref, "failed") };
	const answer = result.data;
	if (typeof answer.lookup === "string" && options.esignPluginId) {
		const lookup = await post<{ state?: string; receipt?: unknown }>(
			ctx,
			options.esignPluginId,
			"public/receipts/lookup",
			{
				request: answer.lookup,
			},
		);
		if (lookup.ok && lookup.data.state === "terminal" && tokenOk(lookup.data.receipt, RECEIPT_MAX)) {
			await post(ctx, options.pluginId, "signatures/receipt", { receipt: lookup.data.receipt });
		}
	}
	const status = answer.signature?.status;
	const notice: WaiverNotice =
		status === "completed"
			? "signed"
			: status === "declined" || status === "voided" || status === "expired"
				? status
				: "failed";
	return { location: bookingLocation(input.ref, notice) };
}

/** The signing page e-sign's integration injects (`/sign/[token]`). */
export const SIGN_PATH = "/sign/";

/** Records a completed envelope's receipt, fetched with the door link's lookup request. */
async function recordSigned(ctx: PublicRouteContext, lookup: unknown, options: ReceiptOptions): Promise<boolean> {
	if (!options.esignPluginId || !tokenOk(lookup, RECEIPT_MAX)) return false;
	const found = await post<{ state?: string; receipt?: unknown }>(
		ctx,
		options.esignPluginId,
		"public/receipts/lookup",
		{
			request: lookup,
		},
	);
	if (!found.ok || found.data.state !== "terminal" || !tokenOk(found.data.receipt, RECEIPT_MAX)) return false;
	const stored = await post<ReceiptAnswer>(ctx, options.pluginId, "signatures/receipt", {
		receipt: found.data.receipt,
	});
	return stored.ok && stored.data.signature?.status === "completed";
}

/**
 * Redeem a door-signing intent with e-sign and go to its signing page; `{ signed: true }` when the
 * waiver was already signed and is now on record.
 */
export async function startDoorSigning(
	ctx: PublicRouteContext,
	intent: unknown,
	options: ReceiptOptions,
	lookup?: unknown,
): Promise<{ location: string } | { signed: true } | { error: string }> {
	if (!options.esignPluginId) return { error: "ESIGN_NOT_CONFIGURED" };
	if (!tokenOk(intent, INTENT_MAX)) return { error: "INTENT_INVALID" };
	const result = await post<{ status?: unknown; signingToken?: unknown }>(
		ctx,
		options.esignPluginId,
		"public/envelopes/from-intent",
		{ intent },
	);
	if (!result.ok) return { error: result.error.code };
	const token = result.data.signingToken;
	if (typeof token === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(token)) return { location: `${SIGN_PATH}${token}` };
	if (result.data.status === "completed" && (await recordSigned(ctx, lookup, options))) return { signed: true };
	return { error: "SIGNING_UNAVAILABLE" };
}
