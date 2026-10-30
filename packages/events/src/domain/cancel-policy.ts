/**
 * Self-service cancellation policy (EV-US-4). Pure: time is passed in.
 *
 * A buyer may cancel a confirmed booking until `cancelCutoffHours` before the event starts. The
 * start comes from the booked occurrence (the event config's catalog), or for an event without
 * occurrences from its `salesEnd`; with neither, cancelling stays open. A booking still being held
 * or paid for (not yet confirmed) may always be abandoned: nothing was sold.
 */
import type { BookingDoc, EventConfigDoc } from "../storage/schema";
import { HOLD_STATUSES } from "./holds";
import { clampSetting } from "./settings";
import { iso } from "./time";

export const DEFAULT_CANCEL_CUTOFF_HOURS = 24;
const HOUR = 3_600_000;

/** Hours before the start after which self-service cancel closes (0 to 720; default 24). */
export function cancelCutoffHours(raw: { cancelCutoffHours?: unknown }): number {
	return clampSetting(raw.cancelCutoffHours, DEFAULT_CANCEL_CUTOFF_HOURS, 0, 720);
}

type PolicyConfig = Pick<EventConfigDoc, "catalog" | "salesEnd">;

/** The instant the booking's event starts (ms), or `null` when the config does not say. */
export function referenceStart(
	booking: Pick<BookingDoc, "occurrenceId">,
	config: PolicyConfig | null | undefined,
): number | null {
	const occurrences = config?.catalog?.occurrences;
	const occ =
		booking.occurrenceId !== undefined && occurrences && Object.hasOwn(occurrences, booking.occurrenceId)
			? occurrences[booking.occurrenceId]
			: undefined;
	const iso = occ?.startsAt ?? (booking.occurrenceId === undefined ? config?.salesEnd : undefined);
	const ms = Date.parse(iso ?? "");
	return Number.isFinite(ms) ? ms : null;
}

export type CancelDecision =
	| { allowed: true; kind: "abandon" | "confirmed"; cancelBy: string | null }
	| { allowed: false; reason: "STATUS" | "TOO_LATE"; cancelBy: string | null };

export function cancelDecision(
	booking: Pick<BookingDoc, "status" | "occurrenceId">,
	config: PolicyConfig | null | undefined,
	cutoffHours: number,
	now: number,
): CancelDecision {
	if (HOLD_STATUSES.includes(booking.status)) return { allowed: true, kind: "abandon", cancelBy: null };
	if (booking.status !== "confirmed") return { allowed: false, reason: "STATUS", cancelBy: null };
	const start = referenceStart(booking, config);
	if (start === null) return { allowed: true, kind: "confirmed", cancelBy: null };
	const deadline = start - cutoffHours * HOUR;
	const cancelBy = iso(deadline);
	return now <= deadline
		? { allowed: true, kind: "confirmed", cancelBy }
		: { allowed: false, reason: "TOO_LATE", cancelBy };
}
