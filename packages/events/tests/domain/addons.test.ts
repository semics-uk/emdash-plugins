/**
 * T174d: a per-person add-on line (Events Pro marks the ticket type; the Free core only counts it). An add-on line
 * (`addon: true`, copied from the catalog type when reserve plans the order) keeps its own ticket-type counter but is
 * not a place: the occurrence and event counters, attendees, waiver seats and the seat counts in emails leave it out.
 * Every counter path (reserve, release, confirm, drift repair) goes through `countersForBooking`, so they agree.
 */
import { describe, expect, it } from "vitest";

import { planAttendees } from "../../src/domain/booking-state";
import { planCheckout, type ReserveInput } from "../../src/domain/checkout";
import { catalogOf } from "../../src/domain/config";
import {
	counterlessChanges,
	countersForBooking,
	planDriftRepair,
	seatCount,
	tallyBookings,
} from "../../src/domain/inventory";
import { seatIds } from "../../src/domain/receipts";
import type { BookingDoc, EventConfigDoc, TicketTypeDoc } from "../../src/storage/schema";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const tt = (over: Partial<TicketTypeDoc> = {}): TicketTypeDoc => ({
	eventId: "e1",
	name: "Party",
	priceMinor: 4000,
	capacity: 20,
	reserved: 0,
	sold: 0,
	hidden: false,
	sort: 0,
	...over,
});

/** An event with a place (`tt_p`, £40) and a quad trek add-on (`tt_q`, £54, 6 in stock) as Pro serves its catalog. */
function config(over: Partial<EventConfigDoc> = {}): EventConfigDoc {
	const catalog = catalogOf(
		[
			{ id: "tt_p", data: tt() },
			{ id: "tt_q", data: tt({ name: "Quad trek", priceMinor: 5400, capacity: 6 }) },
		],
		[],
	);
	(catalog.ticketTypes.tt_q as { addon?: boolean }).addon = true;
	return {
		status: "on_sale",
		capacity: 10,
		reserved: 0,
		sold: 0,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: false,
		catalog,
		...over,
	};
}

const order = (lines: ReserveInput["lines"]): ReserveInput => ({
	eventId: "e1",
	lines,
	buyer: { name: "Ada", email: "ada@example.com" },
	idempotencyKey: "k".repeat(32),
});

const quadOrder = [
	{ ticketTypeId: "tt_p", qty: 4 },
	{ ticketTypeId: "tt_q", qty: 4 },
];
const lines = [
	{ ticketTypeId: "tt_p", qty: 4, unitPriceMinor: 4000 },
	{ ticketTypeId: "tt_q", qty: 4, unitPriceMinor: 5400, addon: true },
];

describe("T174d planning an order with an add-on", () => {
	it("T174d 4 people + 4 quad treks: 4 x base + 4 x £54, the add-on line marked, 4 places on the event", () => {
		const r = planCheckout("e1", config(), order(quadOrder), NOW, { maxSteps: 6 });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.lines).toEqual(lines);
		expect(r.value.totals).toMatchObject({ subtotalMinor: 4 * 4000 + 4 * 5400, totalMinor: 37_600 });
		expect(r.value.steps.map(({ collection, id, qty }) => [collection, id, qty])).toEqual([
			["ticket_types", "tt_p", 4],
			["ticket_types", "tt_q", 4],
			["event_configs", "e1", 4],
		]);
	});

	it("T174d the event's capacity is checked on places only: a nearly full house still takes its add-ons", () => {
		const r = planCheckout("e1", config({ reserved: 6 }), order(quadOrder), NOW, { maxSteps: 6 });
		expect(r.ok).toBe(true);
		expect(planCheckout("e1", config({ reserved: 7 }), order(quadOrder), NOW, { maxSteps: 6 })).toMatchObject({
			ok: false,
			error: { code: "SOLD_OUT" },
		});
	});

	it("T174d a type without the mark is a place, as before (no `addon` key on its line)", () => {
		const r = planCheckout("e1", config(), order([{ ticketTypeId: "tt_p", qty: 2 }]), NOW, { maxSteps: 6 });
		expect(r.ok && r.value.lines).toStrictEqual([{ ticketTypeId: "tt_p", qty: 2, unitPriceMinor: 4000 }]);
	});
});

describe("T174d counters: add-ons keep their own counter, never the event's or the date's", () => {
	const booking = { eventId: "e1", occurrenceId: "oc1", lines };

	it("T174d countersForBooking: the add-on type counts its quantity; the date and event count places", () => {
		expect(countersForBooking(booking)).toEqual([
			{ collection: "ticket_types", id: "tt_p", qty: 4 },
			{ collection: "ticket_types", id: "tt_q", qty: 4 },
			{ collection: "occurrences", id: "oc1", qty: 4 },
			{ collection: "event_configs", id: "e1", qty: 4 },
		]);
		expect(seatCount(lines)).toBe(4);
	});

	it("T174d drift repair tallies the same way, so it never moves add-ons onto the event", () => {
		const b = (status: BookingDoc["status"]) =>
			({ ...booking, status, createdAt: new Date(NOW - 3_600_000).toISOString() }) as BookingDoc;
		const tally = tallyBookings([b("held"), b("confirmed")], NOW);
		expect(Object.fromEntries(tally)).toEqual({
			"ticket_types/tt_p": { reserved: 8, sold: 4 },
			"ticket_types/tt_q": { reserved: 8, sold: 4 },
			"occurrences/oc1": { reserved: 8, sold: 4 },
			"event_configs/e1": { reserved: 8, sold: 4 },
		});
		// Counters a reserve wrote for these two bookings are already right: nothing to fix.
		const snapshot = [
			{ collection: "ticket_types" as const, id: "tt_q", reserved: 8, sold: 4 },
			{ collection: "event_configs" as const, id: "e1", reserved: 8, sold: 4 },
		];
		expect(planDriftRepair(snapshot, tally)).toEqual([]);
		// An event counter that took the add-ons too is brought back to its places.
		expect(planDriftRepair([{ collection: "event_configs", id: "e1", reserved: 16, sold: 8 }], tally)).toEqual([
			{ collection: "event_configs", id: "e1", from: { reserved: 16, sold: 8 }, to: { reserved: 8, sold: 4 } },
		]);
	});

	it("T174d the event's add-on list belongs to Pro: a Free config save never diffs it", () => {
		expect(counterlessChanges({ capacity: 10, addons: ["tt_q"] }, { capacity: 10 })).toBeNull();
	});

	it("T160 the waiver order belongs to Pro: a Free config save never resets it", () => {
		const stored = { capacity: 10, waiverTiming: "after-payment", waiverAllowDecline: "on" };
		expect(counterlessChanges(stored, { capacity: 10 })).toBeNull();
		expect(counterlessChanges(stored, { capacity: 12 })).toEqual({ capacity: 12 });
	});
});

describe("T174d an add-on is not a seat", () => {
	const booking = {
		eventId: "e1",
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		lines,
	} as Pick<BookingDoc, "eventId" | "lines" | "buyer">;

	it("T174d 4 people + 4 quad treks make 4 attendees, all on the place type", () => {
		const planned = planAttendees("bk_1", booking, undefined, { status: "valid", newCode: () => "c" });
		expect(planned.ok && planned.value.map((a) => a.data.ticketTypeId)).toEqual(["tt_p", "tt_p", "tt_p", "tt_p"]);
	});

	it("T174d named attendees match the places only; naming an add-on is a mismatch", () => {
		const four = Array.from({ length: 4 }, (_, i) => ({ ticketTypeId: "tt_p", name: `P${i}` }));
		expect(planAttendees("bk_1", booking, four, { status: "valid", newCode: () => "c" }).ok).toBe(true);
		const withQuad = [...four, { ticketTypeId: "tt_q", name: "Quad" }];
		expect(planAttendees("bk_1", booking, withQuad, { status: "valid", newCode: () => "c" })).toEqual({
			ok: false,
			error: [{ path: "attendees", code: "ATTENDEES_MISMATCH" }],
		});
	});

	it("T174d waiver seats (receipt refs) are the places only", () => {
		expect(seatIds("bk_1", { lines })).toEqual(["bk_1-1", "bk_1-2", "bk_1-3", "bk_1-4"]);
	});
});
