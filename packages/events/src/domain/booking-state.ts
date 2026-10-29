/**
 * The booking state machine (BUILD-PLAN 3.1, EV-FR-07), shared by checkout, the payment webhook,
 * signature receipts, cancel and refund. Pure: time and randomness are passed in.
 *
 * ```
 *             ┌────────────► expired (hold lapsed; the expirer releases the seats)
 *  draft ──► held ──► awaiting_signature ──► awaiting_payment ──► [awaiting_approval] ──► confirmed ──► cancelled / refunded
 *             └───────────────┴──── (steps skipped when not required) ──┘          └──► declined / expired / cancelled
 * ```
 * `refunded_unavailable` is a payment that arrived after its hold had lapsed and was refunded.
 * `awaiting_approval` (T131, R97) comes after every checkout step when the event requires approval:
 * a hold state whose `holdExpiresAt` is the approval deadline, so the sweeper expires it like a hold.
 */
import { err, ok, type Result } from "@semics-tech/shared";

import type {
	AttendeeDoc,
	AttendeeStatus,
	BookingDoc,
	BookingStatus,
	EventConfigDoc,
	OutboxDoc,
} from "../storage/schema";
import type { InputIssue } from "./checkout";
import { HOLD_STATUSES } from "./holds";
import { iso } from "./time";

export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
	draft: ["held", "expired"],
	held: ["awaiting_signature", "awaiting_payment", "awaiting_approval", "confirmed", "expired", "cancelled"],
	awaiting_signature: ["awaiting_payment", "awaiting_approval", "confirmed", "expired", "cancelled"],
	awaiting_payment: ["awaiting_approval", "confirmed", "expired", "cancelled", "refunded_unavailable"],
	awaiting_approval: ["confirmed", "declined", "expired", "cancelled"],
	confirmed: ["cancelled", "refunded"],
	expired: ["refunded_unavailable"],
	cancelled: ["refunded"],
	refunded: [],
	refunded_unavailable: [],
	declined: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
	return BOOKING_TRANSITIONS[from].includes(to);
}

export type StepType = "sign" | "pay" | "done";

/** What the booking still needs, beyond what its own fields say. */
export interface StepRequirements {
	/** The buyer still has a waiver to sign inline (Pro; Free never sets it). */
	signaturePending: boolean;
}

/**
 * The checkout step a booking is at, and the status that step puts it in: sign, then pay, then
 * done. `null` when checkout cannot go on (a draft still reserving, or a closed booking). A paid
 * booking stays at `pay` until the payment provider confirms it; checkout never does.
 */
export function nextStep(
	booking: Pick<BookingDoc, "status" | "totals">,
	{ signaturePending }: StepRequirements,
): { type: StepType; status: BookingStatus } | null {
	if (booking.status === "confirmed") return { type: "done", status: "confirmed" };
	if (!HOLD_STATUSES.includes(booking.status)) return null;
	if (signaturePending) return { type: "sign", status: "awaiting_signature" };
	if (booking.totals.totalMinor > 0) return { type: "pay", status: "awaiting_payment" };
	return { type: "done", status: "confirmed" };
}

export type CheckoutState = "open" | "lapsed" | "pending" | "confirmed" | "closed";

/**
 * Where a booking stands for checkout at `now`: `open` (a running, unclaimed hold), `lapsed` (in a
 * hold state but expired or claimed by an expirer: it cannot be revived), `pending` (a draft whose
 * reserve is still running), `confirmed` (also `awaiting_approval`: checkout is done, T131), or
 * `closed` (expired, cancelled, refunded, declined).
 */
export function checkoutState(
	booking: Pick<BookingDoc, "status" | "holdExpiresAt" | "releaseClaimedAt">,
	now: number,
): CheckoutState {
	if (booking.status === "confirmed" || booking.status === "awaiting_approval") return "confirmed";
	if (booking.status === "draft") return "pending";
	if (!HOLD_STATUSES.includes(booking.status)) return "closed";
	const expires = Date.parse(booking.holdExpiresAt ?? "");
	return !booking.releaseClaimedAt && Number.isFinite(expires) && expires > now ? "open" : "lapsed";
}

export interface AttendeeInput {
	ticketTypeId: string;
	name: string;
	email?: string | undefined;
	minor?: boolean | undefined;
}

/** Attendee document ids are fixed by the booking, so writing them again replaces, never adds. */
export const attendeeId = (bookingId: string, n: number) => `${bookingId}-${n}`;

/** One confirmation message per booking: its id makes queueing it again a replacement. */
export const confirmationOutboxId = (bookingId: string) => `confirm-${bookingId}`;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The attendee documents for a booking: one per seat, in ticket-type id order. Without `attendees`
 * every seat is in the buyer's name; otherwise the list must name exactly the booked seats per
 * ticket type. Emails default to the buyer's and are stored lower-case. Each gets a fresh
 * check-in code from `newCode`.
 */
export function planAttendees(
	bookingId: string,
	booking: Pick<BookingDoc, "eventId" | "occurrenceId" | "lines" | "buyer">,
	attendees: readonly AttendeeInput[] | undefined,
	{ status, newCode }: { status: AttendeeStatus; newCode: () => string },
): Result<Array<{ id: string; data: AttendeeDoc }>, InputIssue[]> {
	const seats = new Map<string, number>();
	for (const line of booking.lines) seats.set(line.ticketTypeId, (seats.get(line.ticketTypeId) ?? 0) + line.qty);
	const buyer = { name: booking.buyer.name, email: booking.buyer.email };
	const people = new Map<string, Array<{ name: string; email: string; minor?: boolean }>>();
	if (attendees === undefined) {
		for (const [type, qty] of seats)
			people.set(
				type,
				Array.from({ length: qty }, () => buyer),
			);
	} else {
		for (const a of attendees) {
			const list = people.get(a.ticketTypeId) ?? [];
			list.push({
				name: a.name,
				email: (a.email ?? buyer.email).trim().toLowerCase(),
				...(a.minor === true ? { minor: true } : {}),
			});
			people.set(a.ticketTypeId, list);
		}
		const matches = people.size === seats.size && [...seats].every(([type, qty]) => people.get(type)?.length === qty);
		if (!matches) return err([{ path: "attendees", code: "ATTENDEES_MISMATCH" }]);
	}
	const docs: Array<{ id: string; data: AttendeeDoc }> = [];
	for (const type of [...seats.keys()].sort(byId)) {
		for (const person of people.get(type) ?? []) {
			docs.push({
				id: attendeeId(bookingId, docs.length + 1),
				data: {
					bookingId,
					eventId: booking.eventId,
					...(booking.occurrenceId !== undefined ? { occurrenceId: booking.occurrenceId } : {}),
					ticketTypeId: type,
					name: person.name,
					email: person.email,
					code: newCode(),
					status,
					...(person.minor ? { minor: true } : {}),
				},
			});
		}
	}
	return ok(docs);
}

/** An outbox row for `b`'s buyer (or `to`), due at `at` (ISO). Rows hold ids only (T050). */
export const outboxRow = (
	kind: string,
	id: string,
	b: Pick<BookingDoc, "ref" | "email">,
	at: string,
	to = b.email,
) => ({
	kind,
	to,
	payload: { bookingId: id, bookingRef: b.ref } as Record<string, unknown>,
	attempts: 0,
	nextAttemptAt: at,
	status: "pending" as OutboxDoc["status"],
});

/**
 * The queued confirmation email. It carries references only: the sender (T050) renders the
 * message and reads the attendees at send time, so the queue never holds a token or a ticket code.
 */
export function confirmationMessage(
	bookingId: string,
	booking: Pick<BookingDoc, "ref" | "email">,
	now: number,
): OutboxDoc {
	return outboxRow("booking_confirmed", bookingId, booking, iso(now));
}

/** Default `approval.deadlineHours` (T131). */
export const APPROVAL_HOURS = 48;

/**
 * The approval a new booking needs (T131), copied onto it at reserve (and by a waitlist offer) like
 * the waiver, so a later change to the event does not change it: decided by `until`, the earlier of
 * `deadlineHours` from now and the start of the booked date (or of the event).
 */
export function approvalOf(
	config: Pick<EventConfigDoc, "approval" | "catalog" | "info">,
	occurrenceId: string | undefined,
	now: number,
): Pick<BookingDoc, "approval"> {
	if (!config.approval?.required) return {};
	const until = now + (config.approval.deadlineHours || APPROVAL_HOURS) * 3_600_000;
	const start = Date.parse(
		(occurrenceId ? config.catalog?.occurrences[occurrenceId]?.startsAt : config.info?.startsAt) ?? "",
	);
	return { approval: { until: iso(start < until ? start : until) } };
}

/** The admin addresses in `adminNotifyEmails` (comma, semicolon, space or line separated): at most 5. */
export const adminRecipients = (raw: unknown): string[] =>
	(typeof raw === "string" ? raw.toLowerCase().split(/[\s,;]+/) : [])
		.filter((e) => /^[^@]+@[^@]+\.[^@]+$/.test(e))
		.slice(0, 5);

export interface Settled {
	status: "confirmed" | "awaiting_approval";
	/** The booking fields to write, guarded on the hold read (`heldGuard`). */
	set: Record<string, unknown>;
	/** The outbox rows to queue with it (one `putMany`); `confirm-<id>` or `request-<id>` marks them done. */
	outbox: Array<{ id: string; data: OutboxDoc }>;
}

/**
 * Where a booking goes once its checkout steps (signatures, payment) are done (T131, R97): with a
 * copied `approval` it waits in `awaiting_approval` until the deadline (places stay reserved; the
 * buyer is told the request arrived, and an expiry notice is queued for the deadline, which the drain
 * sends only if the request lapsed), else it is `confirmed` (the caller counts the sale). Admins in
 * `adminNotifyEmails` are told per `notifyAdminOn`: `requests` (default), `all` bookings, or `off`.
 * Free checkout and signature receipts settle through here; Pro's payment confirm should too (T132).
 */
export function settle(id: string, b: BookingDoc, settings: Record<string, unknown>, now: number): Settled {
	const at = iso(now);
	const notify = settings.notifyAdminOn ?? "requests";
	const until = b.approval?.until;
	const outbox = (
		notify === "all" || (until && notify === "requests") ? adminRecipients(settings.adminNotifyEmails) : []
	).map((to, n) => ({ id: `admin-${id}-${n}`, data: outboxRow("approval_admin", id, b, at, to) }));
	if (until) {
		outbox.push(
			{ id: `request-${id}`, data: outboxRow("approval_requested", id, b, at) },
			{ id: `lapse-${id}`, data: outboxRow("approval_expired", id, b, until) },
		);
		return { status: "awaiting_approval", set: { status: "awaiting_approval", holdExpiresAt: until }, outbox };
	}
	outbox.push({ id: confirmationOutboxId(id), data: confirmationMessage(id, b, now) });
	return { status: "confirmed", set: { status: "confirmed", confirmedAt: at }, outbox };
}
