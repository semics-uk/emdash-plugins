import type { ErrorCode, Result } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { checkoutState, confirmationMessage, confirmationOutboxId, settle } from "../domain/booking-state";
import { extendHold, heldGuard, holdSettings, stepTarget } from "../domain/holds";
import { type CounterStorage, confirmSold, countersForBooking } from "../domain/inventory";
import { mergeSignature, parseReceiptRef, receiptAttendeeIds, seatIds, type VerifiedReceipt } from "../domain/receipts";
import { readSettings } from "../domain/settings";
import type { AttendeeDoc, BookingDoc, BookingStatus } from "../storage/schema";
import { badRequest, fail } from "./reply";

/**
 * `POST signatures/receipt` (EV-FR-12, SX-FR-04; esign-intent/1 §8.4): records an e-sign receipt
 * for a waiver booking and moves the booking on. The receipt is the credential (an HMAC under the
 * pairing secret), so the body carries nothing else and there is no access token or rate limit, as
 * for e-sign's own HMAC-authenticated routes.
 *
 * The Pro receipt step verifies the token and says which attendees the booking waits for (the
 * buyer and the minors they sign for; other adults sign by email and are refused at check-in until
 * they do). This core does the bookkeeping:
 * - `ref` → booking (`bookings.query` by ref) and seat; a ref it never issued is `REF_UNKNOWN`;
 * - the receipt is stored on the attendee with its envelope id, idempotent and monotonic
 *   (`mergeSignature`); a completed receipt makes a pending attendee `valid`;
 * - while the booking is `awaiting_signature`: once every awaited attendee has a completed receipt,
 *   a free booking is confirmed (sold counted, confirmation queued, as checkout continue does) and a
 *   paid one moves to `awaiting_payment` (the next continue starts the payment); otherwise a new
 *   receipt extends the hold for the next signer (a replay writes nothing). Declined, voided and expired receipts are recorded and leave
 *   the booking waiting: continue mints a fresh intent, for which e-sign opens a new envelope.
 * Every booking write is guarded on the status read and `releaseClaimedAt: null`; a miss means an
 * expirer claimed the hold (`HOLD_EXPIRED`).
 *
 * Bridge calls (R22: hard limit 10, design target 8): `settings.list` (the pairing), the booking
 * query, `attendees.getMany`, `attendees.putMany` (only when something changed), then either the
 * hold extension (1), or the confirm: `updateIf` (1), `confirmSold` (one per counter, cut to what the
 * budget leaves; drift repair finishes it) and the outbox write (1). Confirming a one-ticket-type
 * booking is 8 calls, 9 with an occurrence. A replay writes nothing: on a confirmed booking it only
 * checks that the confirmation was queued (1), queueing it if an earlier run died first.
 *
 * Free has no step (waivers are Pro): the declared Free route stays the stub that answers NOT_FOUND.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;
type Where = Record<string, unknown>;
type Item = { id: string; data: unknown };

export const RECEIPT_MAX_CALLS = 10;
export const RECEIPT_TARGET_CALLS = 8;
/** §4: a receipt token is at most 2048 characters. */
const MAX_RECEIPT_LENGTH = 2048;

export interface ReceiptStorage extends CounterStorage {
	bookings: {
		get(id: string): Promise<unknown>;
		query(options: { where: Where; limit: number }): Promise<{ items: Item[] }>;
		updateIf(id: string, args: { where: Where; set?: Where }): Promise<{ applied: boolean }>;
	};
	attendees: {
		getMany(ids: string[]): Promise<Map<string, unknown>>;
		putMany(items: Item[]): Promise<void>;
	};
	outbox: {
		get(id: string): Promise<unknown>;
		put(id: string, data: unknown): Promise<void>;
		putMany(items: Item[]): Promise<void>;
	};
}

export type ReceiptAttendee = { id: string; data: AttendeeDoc };

/** The Pro side of receipts (waivers, EV-FR-12). */
export interface ReceiptStep {
	/** Verify the token with the pairing in `settings` (read once by this route). */
	verify(token: string, settings: Record<string, unknown>): Promise<Result<VerifiedReceipt, ErrorCode>>;
	/** The attendee ids the booking waits for before it leaves `awaiting_signature`. */
	awaited(booking: BookingDoc, attendees: ReceiptAttendee[]): string[];
	/** Extra answer fields, e.g. a `receipts/lookup` request while `pdfSha256` is null. No bridge calls. */
	extras?(receipt: VerifiedReceipt, settings: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ReceiptDeps {
	storage: ReceiptStorage;
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	/** Absent in the Free edition. */
	step?: ReceiptStep | undefined;
	now: number;
}

function parseInput(raw: unknown): string | null {
	const receipt = raw && typeof raw === "object" ? (raw as { receipt?: unknown }).receipt : undefined;
	return typeof receipt === "string" && receipt.length > 0 && receipt.length <= MAX_RECEIPT_LENGTH ? receipt : null;
}

const completed = (a: AttendeeDoc | undefined) => a?.signature?.status === "completed";

/** Calls `confirm` keeps after counting the sale: the outbox write. */
const AFTER_SOLD_CALLS = 1;

/**
 * Leave `awaiting_signature` once every awaited attendee has signed: confirm a free booking, move a
 * paid one to `awaiting_payment`; else extend the hold. Returns the booking's status after, or a code.
 */
async function advance(
	deps: ReceiptDeps,
	id: string,
	booking: BookingDoc,
	attendees: ReceiptAttendee[],
	step: ReceiptStep,
	settings: Record<string, unknown>,
	used: number,
	changed: boolean,
): Promise<{ status: BookingStatus } | { code: ErrorCode }> {
	const { storage, now } = deps;
	if (checkoutState(booking, now) !== "open") return { code: "HOLD_EXPIRED" };
	const byId = new Map(attendees.map((a) => [a.id, a.data]));
	const done = step.awaited(booking, attendees).every((a) => completed(byId.get(a)));
	const paid = booking.totals.totalMinor > 0;
	// A replay that completes nothing is a no-op (§8.4); one that finds every signature in (an
	// earlier run died before moving the booking on) finishes the move.
	if (!done && !changed) return { status: booking.status };
	if (!done || paid) {
		const until = stepTarget(now, { paid }, holdSettings(settings));
		const set = done ? { status: "awaiting_payment" } : {};
		const extended = await extendHold(storage.bookings, id, booking, now, until, set);
		if (!extended.ok) return { code: "HOLD_EXPIRED" };
		return { status: done ? "awaiting_payment" : booking.status };
	}
	// Confirm, or wait for the admin's approval (T131): `settle` says which and what to queue.
	const s = settle(id, booking, settings, now);
	const { applied } = await storage.bookings.updateIf(id, { where: heldGuard(booking), set: s.set });
	if (!applied) {
		// Claimed by an expirer, or settled by a concurrent receipt (which queues the rows).
		const fresh = (await storage.bookings.get(id)) as BookingDoc | null;
		return fresh?.status === s.status ? { status: s.status } : { code: "HOLD_EXPIRED" };
	}
	if (s.status === "confirmed") {
		const room = RECEIPT_MAX_CALLS - used - 1 - AFTER_SOLD_CALLS;
		await confirmSold(storage, countersForBooking(booking).slice(0, Math.max(room, 0))).catch(() => undefined);
	}
	await storage.outbox.putMany(s.outbox);
	return { status: s.status };
}

export async function recordReceipt(deps: ReceiptDeps, raw: unknown): Promise<unknown> {
	const token = parseInput(raw);
	if (token === null) return badRequest([{ path: "receipt", code: "INVALID" }]);
	const { step, storage } = deps;
	if (!step) return fail("NOT_FOUND");

	const settings = await readSettings(deps);
	const verified = await step.verify(token, settings);
	if (!verified.ok) return fail(verified.error);
	const receipt = verified.value;
	const ref = parseReceiptRef(receipt.ref);
	if (!ref) return fail("REF_UNKNOWN");

	const { items } = await storage.bookings.query({ where: { ref: ref.bookingRef }, limit: 1 });
	const found = items[0];
	const booking = found?.data as BookingDoc | undefined;
	const targets = found && booking?.waiver ? receiptAttendeeIds(found.id, booking, ref) : null;
	if (!found || !booking || !targets) return fail("REF_UNKNOWN");

	const ids = seatIds(found.id, booking);
	const stored = await storage.attendees.getMany(ids);
	if (targets.some((t) => !stored.has(t))) return fail("REF_UNKNOWN");
	const changed: ReceiptAttendee[] = [];
	for (const id of targets) {
		const doc = stored.get(id) as AttendeeDoc;
		const signature = mergeSignature(doc.signature, receipt);
		if (!signature) continue;
		const status = signature.status === "completed" && doc.status === "pending" ? "valid" : doc.status;
		const next = { ...doc, signature, status };
		changed.push({ id, data: next });
		stored.set(id, next);
	}
	let used = 3;
	if (changed.length > 0) {
		await storage.attendees.putMany(changed);
		used += 1;
	}
	const attendees = ids.filter((id) => stored.has(id)).map((id) => ({ id, data: stored.get(id) as AttendeeDoc }));

	let status: BookingStatus = booking.status;
	if (booking.status === "awaiting_signature") {
		const advanced = await advance(deps, found.id, booking, attendees, step, settings, used, changed.length > 0);
		if ("code" in advanced) return fail(advanced.code);
		status = advanced.status;
	} else if (booking.status === "confirmed" && changed.length === 0) {
		// A replay: make sure the confirmation was queued (an earlier run may have died before it).
		if (!(await storage.outbox.get(confirmationOutboxId(found.id)))) {
			await storage.outbox.put(confirmationOutboxId(found.id), confirmationMessage(found.id, booking, deps.now));
		}
	}
	const extras = step.extras ? await step.extras(receipt, settings) : {};
	return {
		ok: true,
		bookingRef: booking.ref,
		status,
		signature: {
			ref: receipt.ref,
			status: receipt.status,
			pdfPending: receipt.status === "completed" && receipt.pdfSha256 === null,
		},
		...extras,
	};
}

/** The steps a Pro build adds to receipts, built from the invocation's context. */
export interface ReceiptSteps {
	receipts?: (ctx: PluginContext) => ReceiptStep;
}

/** `signatures/receipt` with the given step (none: answers NOT_FOUND, like the Free stub). */
export function signaturesReceiptRoute(steps: ReceiptSteps = {}): RouteDef {
	return {
		methods: ["POST"],
		public: true,
		handler: (async (routeCtx: { input?: unknown }, ctx: PluginContext) =>
			recordReceipt(
				{
					storage: ctx.storage as unknown as ReceiptStorage,
					settings: ctx.settings,
					step: steps.receipts?.(ctx),
					now: Date.now(),
				},
				routeCtx.input,
			)) as Handler,
	};
}
