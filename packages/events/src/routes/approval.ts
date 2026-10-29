import { confirmationMessage, confirmationOutboxId } from "../domain/booking-state";
import { heldGuard } from "../domain/holds";
import { confirmSold, countersForBooking } from "../domain/inventory";
import { iso } from "../domain/time";
import type { BookingDoc } from "../storage/schema";
import { type BookingDeps, type BookingRouteStorage, closeBooking } from "./booking";
import { fail } from "./reply";

/**
 * Booking approval (T131, R96): an admin approves or declines a booking `awaiting_approval` on the
 * Bookings page: the private `admin` route's actions `bookings.approve` (value: booking id) and
 * `bookings.decline:<id>` (form value `reason`), so only signed-in staff act. The admin email links
 * into the admin; no token is mailed. (No separate routes: the bundle budget, R96.)
 *
 * - **approve**: guarded on the hold read (`heldGuard`: status, deadline, `releaseClaimedAt: null`),
 *   so it loses to an expirer or a decline; then counts the sale and queues the confirmation (with its
 *   ICS link). A second approve answers ok (and queues the confirmation if the first died before it).
 *   After the deadline it is refused (`HOLD_EXPIRED`) even before the sweeper has run.
 *   Calls: get, updateIf, one per counter, outbox: 3 + counters (6 for an occurrence booking).
 * - **decline**: `closeBooking` (the cancel protocol: claim, refund a paid booking through the
 *   edition's `RefundStep`, release, move to `declined`, queue `decline-<id>`). Get + 4 + counters.
 * - **expire**: the sweeper's, like any lapsed hold (`awaiting_approval` is a hold state whose
 *   `holdExpiresAt` is the deadline); the expiry notice was queued for the deadline by `settle`.
 *
 * Pro (T132) extends these through `adminRoute({ refund })`, never by copying.
 */
export interface ApprovalDeps extends BookingDeps {
	storage: BookingRouteStorage & {
		bookings: BookingRouteStorage["bookings"] & { get(id: string): Promise<unknown> };
		outbox: { get(id: string): Promise<unknown> };
	};
}

const answer = (b: BookingDoc, status: string) => ({ ok: true, bookingRef: b.ref, status });

export async function approveBooking(deps: ApprovalDeps, id: string): Promise<unknown> {
	const { storage, now } = deps;
	const b = (await storage.bookings.get(id)) as BookingDoc | null;
	if (!b) return fail("NOT_FOUND");
	if (b.status === "confirmed") {
		// A replay: make sure the confirmation went out (an earlier approve may have died first).
		if (!(await storage.outbox.get(confirmationOutboxId(id)))) {
			await storage.outbox.put(confirmationOutboxId(id), confirmationMessage(id, b, now));
		}
		return answer(b, "confirmed");
	}
	const open = b.status === "awaiting_approval" && !b.releaseClaimedAt && Date.parse(b.holdExpiresAt ?? "") > now;
	if (!open) return fail("HOLD_EXPIRED");
	const { applied } = await storage.bookings.updateIf(id, {
		where: heldGuard(b),
		set: { status: "confirmed", confirmedAt: iso(now) },
	});
	if (!applied) return fail("HOLD_EXPIRED");
	await confirmSold(storage, countersForBooking(b)).catch(() => undefined);
	await storage.outbox.put(confirmationOutboxId(id), confirmationMessage(id, b, now));
	return answer(b, "confirmed");
}

/** Decline `id` with an optional reason for the buyer (trimmed, at most 300 characters). */
export async function declineBooking(deps: ApprovalDeps, id: string, reason: string, used = 0): Promise<unknown> {
	const b = (await deps.storage.bookings.get(id)) as BookingDoc | null;
	if (!b) return fail("NOT_FOUND");
	return closeBooking(deps, id, b, { reason: reason.trim().slice(0, 300) }, used);
}
