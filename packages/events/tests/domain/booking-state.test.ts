import { describe, expect, it } from "vitest";

import {
	attendeeId,
	BOOKING_TRANSITIONS,
	canTransition,
	checkoutState,
	confirmationOutboxId,
	nextStep,
	planAttendees,
} from "../../src/domain/booking-state";
import type { BookingDoc, BookingStatus } from "../../src/storage/schema";

const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const booking = (over: Partial<BookingDoc> = {}): BookingDoc => ({
	ref: "ABCDEFGHJK",
	eventId: "ev1",
	status: "held",
	holdExpiresAt: at(15),
	holdCeilingAt: at(60),
	releaseClaimedAt: null,
	buyer: { name: "Ada Lovelace", email: "ada@example.com" },
	email: "ada@example.com",
	lines: [
		{ ticketTypeId: "tt_b", qty: 1, unitPriceMinor: 0 },
		{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 0 },
	],
	totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
	answers: {},
	accessTokenHash: "h",
	createdAt: at(0),
	...over,
});

let seq = 0;
const newCode = () => `code-${++seq}`;

describe("booking state machine (EV-FR-07)", () => {
	it("EV-FR-07 follows draft → held → awaiting_signature → awaiting_payment → confirmed, with steps skippable", () => {
		expect(canTransition("draft", "held")).toBe(true);
		expect(canTransition("held", "confirmed")).toBe(true);
		expect(canTransition("held", "awaiting_signature")).toBe(true);
		expect(canTransition("held", "awaiting_payment")).toBe(true);
		expect(canTransition("awaiting_signature", "awaiting_payment")).toBe(true);
		expect(canTransition("awaiting_signature", "confirmed")).toBe(true);
		expect(canTransition("awaiting_payment", "confirmed")).toBe(true);
		expect(canTransition("confirmed", "cancelled")).toBe(true);
		expect(canTransition("confirmed", "refunded")).toBe(true);
	});

	it("EV-FR-07 never goes backwards or out of a closed state", () => {
		expect(canTransition("confirmed", "held")).toBe(false);
		expect(canTransition("awaiting_payment", "awaiting_signature")).toBe(false);
		expect(canTransition("draft", "confirmed")).toBe(false);
		expect(canTransition("expired", "held")).toBe(false);
		expect(canTransition("held", "held")).toBe(false);
		for (const s of ["refunded", "refunded_unavailable"] as BookingStatus[]) {
			expect(BOOKING_TRANSITIONS[s]).toEqual([]);
		}
	});

	it("EV-FR-07 the next step: sign before pay before done", () => {
		const free = booking();
		const paid = booking({ totals: { subtotalMinor: 500, discountMinor: 0, totalMinor: 500, currency: "GBP" } });
		expect(nextStep(free, { signaturePending: false })).toEqual({ type: "done", status: "confirmed" });
		expect(nextStep(paid, { signaturePending: false })).toEqual({ type: "pay", status: "awaiting_payment" });
		expect(nextStep(paid, { signaturePending: true })).toEqual({ type: "sign", status: "awaiting_signature" });
		expect(nextStep({ ...paid, status: "awaiting_payment" }, { signaturePending: false })).toEqual({
			type: "pay",
			status: "awaiting_payment",
		});
		expect(nextStep(booking({ status: "awaiting_signature" }), { signaturePending: false })).toEqual({
			type: "done",
			status: "confirmed",
		});
		expect(nextStep(booking({ status: "confirmed" }), { signaturePending: false })).toEqual({
			type: "done",
			status: "confirmed",
		});
		expect(nextStep(booking({ status: "expired" }), { signaturePending: false })).toBeNull();
		expect(nextStep(booking({ status: "draft" }), { signaturePending: false })).toBeNull();
	});

	it("EV-FR-07 checkout state: open, lapsed (expired or claimed), pending draft, confirmed, closed", () => {
		expect(checkoutState(booking(), T0)).toBe("open");
		expect(checkoutState(booking(), T0 + 15 * 60_000)).toBe("lapsed");
		expect(checkoutState(booking({ releaseClaimedAt: at(1) }), T0)).toBe("lapsed");
		expect(checkoutState(booking({ holdExpiresAt: undefined }), T0)).toBe("lapsed");
		expect(checkoutState(booking({ status: "awaiting_payment" }), T0)).toBe("open");
		expect(checkoutState(booking({ status: "draft" }), T0)).toBe("pending");
		expect(checkoutState(booking({ status: "confirmed" }), T0)).toBe("confirmed");
		expect(checkoutState(booking({ status: "expired" }), T0)).toBe("closed");
		expect(checkoutState(booking({ status: "cancelled" }), T0)).toBe("closed");
	});
});

describe("attendee planning (EV-FR-07)", () => {
	it("EV-FR-07 defaults every seat to the buyer, in ticket-type order, with stable ids", () => {
		const planned = planAttendees("bk_1", booking(), undefined, { status: "valid", newCode });
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		expect(planned.value.map((a) => [a.id, a.data.ticketTypeId, a.data.name, a.data.email])).toEqual([
			[attendeeId("bk_1", 1), "tt_a", "Ada Lovelace", "ada@example.com"],
			[attendeeId("bk_1", 2), "tt_a", "Ada Lovelace", "ada@example.com"],
			[attendeeId("bk_1", 3), "tt_b", "Ada Lovelace", "ada@example.com"],
		]);
		expect(planned.value[0]?.data).toMatchObject({ bookingId: "bk_1", eventId: "ev1", status: "valid" });
		expect(new Set(planned.value.map((a) => a.data.code)).size).toBe(3);
		expect(planned.value[0]?.data).not.toHaveProperty("occurrenceId");
	});

	it("EV-FR-07 takes the given names, normalises emails, and carries the occurrence", () => {
		const planned = planAttendees(
			"bk_1",
			booking({ occurrenceId: "oc1" }),
			[
				{ ticketTypeId: "tt_b", name: "Kid" },
				{ ticketTypeId: "tt_a", name: "Ada", email: "ADA@example.com" },
				{ ticketTypeId: "tt_a", name: "Charles", email: "charles@example.com" },
			],
			{ status: "pending", newCode },
		);
		expect(planned.ok && planned.value.map((a) => [a.data.ticketTypeId, a.data.name, a.data.email])).toEqual([
			["tt_a", "Ada", "ada@example.com"],
			["tt_a", "Charles", "charles@example.com"],
			["tt_b", "Kid", "ada@example.com"],
		]);
		expect(planned.ok && planned.value[0]?.data).toMatchObject({ occurrenceId: "oc1", status: "pending" });
	});

	it("EV-FR-07 refuses attendees that do not match the booked seats", () => {
		const b = booking();
		for (const attendees of [
			[{ ticketTypeId: "tt_a", name: "One" }],
			[
				{ ticketTypeId: "tt_a", name: "A" },
				{ ticketTypeId: "tt_a", name: "B" },
				{ ticketTypeId: "tt_c", name: "C" },
			],
			[
				{ ticketTypeId: "tt_a", name: "A" },
				{ ticketTypeId: "tt_a", name: "B" },
				{ ticketTypeId: "tt_b", name: "C" },
				{ ticketTypeId: "tt_b", name: "D" },
			],
		]) {
			const planned = planAttendees("bk_1", b, attendees, { status: "valid", newCode });
			expect(planned).toEqual({ ok: false, error: [{ path: "attendees", code: "ATTENDEES_MISMATCH" }] });
		}
	});

	it("EV-FR-07 names the confirmation message after the booking", () => {
		expect(confirmationOutboxId("bk_1")).toBe("confirm-bk_1");
	});
});
