import { describe, expect, it } from "vitest";

import {
	adminRecipients,
	approvalOf,
	BOOKING_TRANSITIONS,
	canTransition,
	checkoutState,
	settle,
} from "../../src/domain/booking-state";
import { cancelDecision } from "../../src/domain/cancel-policy";
import { validateConfigInput } from "../../src/domain/config";
import { expiryAction } from "../../src/domain/holds";
import type { BookingDoc, BookingStatus, EventConfigDoc } from "../../src/storage/schema";

// Booking approval (T131, R97): the state graph, the deadline, and what a booking settles into once
// its checkout steps are done. Pure: time is passed in.

const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();
const ID = "bk_1";

const booking = (over: Partial<BookingDoc> = {}): BookingDoc => ({
	ref: "ABCDEFGHJK",
	eventId: "ev1",
	status: "held",
	holdExpiresAt: at(0.25),
	holdCeilingAt: at(1),
	releaseClaimedAt: null,
	buyer: { name: "Ada Lovelace", email: "ada@example.com" },
	email: "ada@example.com",
	lines: [{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 0 }],
	totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
	answers: {},
	accessTokenHash: "h",
	createdAt: at(0),
	...over,
});

const config = (over: Partial<EventConfigDoc> = {}): EventConfigDoc => ({
	status: "on_sale",
	capacity: 100,
	reserved: 0,
	sold: 0,
	currency: "GBP",
	questions: [],
	signature: { required: false, mode: "each_attendee" },
	waitlistEnabled: false,
	approval: { required: true, deadlineHours: 48 },
	info: { title: "Concert", startsAt: at(240), endsAt: null, timezone: null, venue: null },
	catalog: { ticketTypes: {}, occurrences: { oc1: { capacity: 10, startsAt: at(5), status: "open" } } },
	...over,
});

describe("T131 approval state graph", () => {
	it("T131 every checkout step may hand over to awaiting_approval, which keeps the places", () => {
		for (const from of ["held", "awaiting_signature", "awaiting_payment"] as BookingStatus[]) {
			expect(canTransition(from, "awaiting_approval"), from).toBe(true);
		}
		expect(BOOKING_TRANSITIONS.awaiting_approval).toEqual(
			expect.arrayContaining(["confirmed", "declined", "expired", "cancelled"]),
		);
	});

	it("T131 declined is final, and nothing goes back to waiting for approval", () => {
		expect(BOOKING_TRANSITIONS.declined).toEqual([]);
		for (const from of ["draft", "confirmed", "expired", "cancelled", "declined"] as BookingStatus[]) {
			expect(canTransition(from, "awaiting_approval"), from).toBe(false);
		}
		expect(canTransition("confirmed", "declined")).toBe(false);
	});

	it("T131 checkout is over for a booking awaiting approval; continue only finishes it", () => {
		expect(checkoutState(booking({ status: "awaiting_approval", holdExpiresAt: at(48) }), T0)).toBe("confirmed");
	});

	it("T131 the sweeper releases a request past its deadline, and not before", () => {
		const b = booking({ status: "awaiting_approval", holdExpiresAt: at(48) });
		expect(expiryAction(b, T0 + 47 * HOUR)).toBeNull();
		expect(expiryAction(b, T0 + 48 * HOUR)).toBe("release");
		expect(expiryAction({ ...b, releaseClaimedAt: at(48) }, T0 + 48 * HOUR)).toBeNull();
	});

	it("T131 the buyer may withdraw a request at any time (like abandoning a hold)", () => {
		expect(cancelDecision(booking({ status: "awaiting_approval" }), null, 24, T0)).toMatchObject({
			allowed: true,
			kind: "abandon",
		});
	});
});

describe("T131 approval deadline", () => {
	it("T131 nothing is copied when the event does not require approval", () => {
		expect(approvalOf(config({ approval: null }), undefined, T0)).toEqual({});
		expect(approvalOf(config({ approval: { required: false, deadlineHours: 48 } }), undefined, T0)).toEqual({});
	});

	it("T131 the deadline is deadlineHours after the booking (48 by default)", () => {
		expect(approvalOf(config(), undefined, T0)).toEqual({ approval: { until: at(48) } });
		expect(approvalOf(config({ approval: { required: true, deadlineHours: 0 } }), undefined, T0)).toEqual({
			approval: { until: at(48) },
		});
		expect(approvalOf(config({ approval: { required: true, deadlineHours: 3 } }), undefined, T0)).toEqual({
			approval: { until: at(3) },
		});
	});

	it("T131 the deadline is capped at the start of the booked date, or of the event", () => {
		expect(approvalOf(config(), "oc1", T0)).toEqual({ approval: { until: at(5) } });
		const soon = config({ info: { title: "Concert", startsAt: at(10), endsAt: null, timezone: null, venue: null } });
		expect(approvalOf(soon, undefined, T0)).toEqual({ approval: { until: at(10) } });
		// An unknown date falls back to the event's own deadline.
		expect(approvalOf(config(), "oc_unknown", T0)).toEqual({ approval: { until: at(48) } });
	});
});

describe("T131 approval in the event config", () => {
	const save = (approval: unknown) =>
		validateConfigInput(
			"e1",
			{ config: { status: "on_sale", capacity: 10, currency: "GBP", approval } },
			{ config: null, ticketTypes: new Map(), occurrences: new Map() },
			() => "id",
		);

	it("T131 keeps { required, deadlineHours } with 48 hours by default", () => {
		const r = save({ required: true });
		expect(r.ok && r.value.config.approval).toEqual({ required: true, deadlineHours: 48 });
		const off = save({ required: false, deadlineHours: 12 });
		expect(off.ok && off.value.config.approval).toEqual({ required: false, deadlineHours: 12 });
	});

	it("T131 refuses a deadline that is not 1 to 720 whole hours", () => {
		for (const deadlineHours of [0, 1.5, 721, "48"]) {
			const r = save({ required: true, deadlineHours });
			expect(r.ok ? [] : r.error.map((i) => `${i.path}:${i.code}`), String(deadlineHours)).toEqual([
				"config.approval:INVALID_APPROVAL",
			]);
		}
		expect(save("yes").ok).toBe(false);
	});
});

describe("T131 settle: where a booking goes once its steps are done", () => {
	const settings = (notify?: string, emails = "boss@example.com, desk@example.com") => ({
		adminNotifyEmails: emails,
		...(notify ? { notifyAdminOn: notify } : {}),
	});

	it("T131 without approval it confirms and queues the confirmation; admins hear only with 'all'", () => {
		const s = settle(ID, booking(), settings(), T0);
		expect(s).toMatchObject({ status: "confirmed", set: { status: "confirmed", confirmedAt: at(0) } });
		expect(s.outbox.map((r) => r.id)).toEqual([`confirm-${ID}`]);
		const all = settle(ID, booking(), settings("all"), T0);
		expect(all.outbox.map((r) => [r.id, r.data.kind, r.data.to])).toEqual([
			[`admin-${ID}-0`, "approval_admin", "boss@example.com"],
			[`admin-${ID}-1`, "approval_admin", "desk@example.com"],
			[`confirm-${ID}`, "booking_confirmed", "ada@example.com"],
		]);
	});

	it("T131 with approval it waits until the deadline, tells the buyer and (by default) the admins", () => {
		const s = settle(ID, booking({ approval: { until: at(48) } }), settings(), T0);
		expect(s).toMatchObject({
			status: "awaiting_approval",
			set: { status: "awaiting_approval", holdExpiresAt: at(48) },
		});
		expect(s.outbox.map((r) => [r.id, r.data.kind, r.data.to, r.data.nextAttemptAt])).toEqual([
			[`admin-${ID}-0`, "approval_admin", "boss@example.com", at(0)],
			[`admin-${ID}-1`, "approval_admin", "desk@example.com", at(0)],
			[`request-${ID}`, "approval_requested", "ada@example.com", at(0)],
			// The expiry notice is due at the deadline and is sent only if the request lapsed.
			[`lapse-${ID}`, "approval_expired", "ada@example.com", at(48)],
		]);
		for (const r of s.outbox) expect(r.data).toMatchObject({ payload: { bookingId: ID, bookingRef: "ABCDEFGHJK" } });
	});

	it("T131 notifyAdminOn off (or no addresses) tells no admin", () => {
		const b = booking({ approval: { until: at(48) } });
		expect(settle(ID, b, settings("off"), T0).outbox.map((r) => r.id)).toEqual([`request-${ID}`, `lapse-${ID}`]);
		expect(settle(ID, b, {}, T0).outbox.map((r) => r.id)).toEqual([`request-${ID}`, `lapse-${ID}`]);
	});

	it("T131 admin addresses: comma, space or line separated, lower-cased, invalid ones dropped, at most 5", () => {
		expect(adminRecipients(" A@Example.com;b@example.com\nnot-an-email c@example.com,d@x.io e@x.io f@x.io")).toEqual([
			"a@example.com",
			"b@example.com",
			"c@example.com",
			"d@x.io",
			"e@x.io",
		]);
		expect(adminRecipients(undefined)).toEqual([]);
		expect(adminRecipients(42)).toEqual([]);
	});
});
