/**
 * T174f: a party package, one price for the group (lmsc-site #59: "up to 5 people, 60 shots, £120"). Events Pro marks
 * the ticket type `package` in the catalog it serves reserve; its people are the order's quantity, so the type's
 * `minPerOrder` / `maxPerOrder` are the fewest and most people. Free plans the line as one package for those people
 * (`qty: 1`, `people: n`, priced once), and every place count honours `people`: the counters (reserve, release,
 * confirm, drift repair), attendees, waiver seats, the emails' seat counts and a resubmit's order check. Per-person
 * add-ons (T174d) stay capped by places, so by the package's people.
 */
import { describe, expect, it } from "vitest";

import { planAttendees } from "../../src/domain/booking-state";
import { planCheckout, type ReserveInput, sameOrder } from "../../src/domain/checkout";
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

const NOW = Date.parse("2026-12-01T12:00:00.000Z"); // a Tuesday
const tt = (over: Partial<TicketTypeDoc> = {}): TicketTypeDoc => ({
	eventId: "e1",
	name: "Party package",
	priceMinor: 12_000,
	capacity: 20,
	reserved: 0,
	sold: 0,
	hidden: false,
	sort: 0,
	minPerOrder: 2,
	maxPerOrder: 5,
	...over,
});

/** A request event with a party package (`tt_pk`, £120 for 2 to 5 people) and a quad add-on (`tt_q`, £54 a person). */
function config(over: Partial<EventConfigDoc> = {}): EventConfigDoc {
	const catalog = catalogOf(
		[
			{ id: "tt_pk", data: tt() },
			{
				id: "tt_q",
				data: tt({ name: "Quad trek", priceMinor: 5400, capacity: 6, minPerOrder: null, maxPerOrder: null }),
			},
		],
		[],
	);
	(catalog.ticketTypes.tt_pk as { package?: boolean }).package = true;
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
		requests: {
			windows: [{ id: "am", label: "AM", start: "10:00", end: "12:00" }],
			days: ["SA", "SU"],
			aheadDays: 90,
			noticeDays: 2,
			closedDates: [],
		},
		info: {
			title: "Clay shoot",
			startsAt: "2026-01-01T09:00:00.000Z",
			endsAt: null,
			timezone: "Europe/London",
			venue: null,
		},
		catalog,
		...over,
	};
}

const order = (lines: ReserveInput["lines"]): ReserveInput => ({
	eventId: "e1",
	lines,
	buyer: { name: "Ada", email: "ada@example.com" },
	idempotencyKey: "k".repeat(32),
	request: { date: "2026-12-12", window: "am" },
});
const plan = (c: EventConfigDoc, i: ReserveInput) => planCheckout("e1", c, i, NOW, { maxSteps: 6 });

const threeWithQuads = [
	{ ticketTypeId: "tt_pk", qty: 3 },
	{ ticketTypeId: "tt_q", qty: 3 },
];
const lines = [
	{ ticketTypeId: "tt_pk", qty: 1, unitPriceMinor: 12_000, people: 3 },
	{ ticketTypeId: "tt_q", qty: 3, unitPriceMinor: 5400, addon: true },
];

describe("T174f planning a package order", () => {
	it("T174f 3 people on a £120 package + 3 quads: one package line for 3 people, £120 + 3 x £54, 3 places", () => {
		const r = plan(config(), order(threeWithQuads));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.lines).toEqual(lines);
		expect(r.value.totals).toMatchObject({ subtotalMinor: 12_000 + 3 * 5400, totalMinor: 28_200 });
		expect(r.value.steps.map(({ collection, id, qty }) => [collection, id, qty])).toEqual([
			["ticket_types", "tt_pk", 3],
			["ticket_types", "tt_q", 3],
			["event_configs", "e1", 3],
		]);
	});

	it("T174f the price is the same for any party size between the fewest and most people", () => {
		for (const people of [2, 5]) {
			const r = plan(config(), order([{ ticketTypeId: "tt_pk", qty: people }]));
			expect(r.ok && r.value.totals.totalMinor, `${people} people`).toBe(12_000);
			expect(r.ok && r.value.lines).toEqual([{ ticketTypeId: "tt_pk", qty: 1, unitPriceMinor: 12_000, people }]);
		}
	});

	it("T174f fewer than the fewest or more than the most people is refused", () => {
		for (const people of [1, 6]) {
			expect(plan(config(), order([{ ticketTypeId: "tt_pk", qty: people }])), `${people} people`).toMatchObject({
				ok: false,
				error: { code: "BAD_REQUEST", reason: "INVALID_QUANTITY" },
			});
		}
	});

	it("T174f the event's capacity is checked on the package's people", () => {
		expect(plan(config({ reserved: 7 }), order(threeWithQuads)).ok).toBe(true);
		expect(plan(config({ reserved: 8 }), order(threeWithQuads))).toMatchObject({
			ok: false,
			error: { code: "SOLD_OUT" },
		});
	});

	it("T174f a type without the mark is priced per person, as before (no `people` key on its line)", () => {
		const c = config();
		delete (c.catalog as NonNullable<EventConfigDoc["catalog"]>).ticketTypes.tt_pk?.package;
		const r = plan(c, order([{ ticketTypeId: "tt_pk", qty: 3 }]));
		expect(r.ok && r.value.lines).toStrictEqual([{ ticketTypeId: "tt_pk", qty: 3, unitPriceMinor: 12_000 }]);
	});

	it("T174f a resubmit of the same order (people as the quantity) is the same order", () => {
		const booking = { eventId: "e1", email: "ada@example.com", lines } as Pick<
			BookingDoc,
			"eventId" | "occurrenceId" | "email" | "lines"
		>;
		expect(sameOrder(booking, order(threeWithQuads))).toBe(true);
		expect(
			sameOrder(
				booking,
				order([
					{ ticketTypeId: "tt_pk", qty: 4 },
					{ ticketTypeId: "tt_q", qty: 3 },
				]),
			),
		).toBe(false);
	});
});

describe("T174f counters count the package's people", () => {
	const booking = { eventId: "e1", occurrenceId: "oc1", lines };

	it("T174f countersForBooking and seatCount: 3 places on the type, the date and the event", () => {
		expect(countersForBooking(booking)).toEqual([
			{ collection: "ticket_types", id: "tt_pk", qty: 3 },
			{ collection: "ticket_types", id: "tt_q", qty: 3 },
			{ collection: "occurrences", id: "oc1", qty: 3 },
			{ collection: "event_configs", id: "e1", qty: 3 },
		]);
		expect(seatCount(lines)).toBe(3);
	});

	it("T174f drift repair tallies the same way", () => {
		const b = (status: BookingDoc["status"]) =>
			({ ...booking, status, createdAt: new Date(NOW - 3_600_000).toISOString() }) as BookingDoc;
		const tally = tallyBookings([b("held"), b("confirmed")], NOW);
		expect(Object.fromEntries(tally)).toMatchObject({
			"ticket_types/tt_pk": { reserved: 6, sold: 3 },
			"event_configs/e1": { reserved: 6, sold: 3 },
		});
		expect(planDriftRepair([{ collection: "event_configs", id: "e1", reserved: 6, sold: 3 }], tally)).toEqual([]);
	});

	it("T174f the event's package list belongs to Pro: a Free config save never diffs it", () => {
		expect(counterlessChanges({ capacity: 10, packages: ["tt_pk"] }, { capacity: 10 })).toBeNull();
	});
});

describe("T174f each of the package's people is a seat", () => {
	const booking = {
		eventId: "e1",
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		lines,
	} as Pick<BookingDoc, "eventId" | "lines" | "buyer">;

	it("T174f a 3-person package makes 3 attendees on the package type", () => {
		const planned = planAttendees("bk_1", booking, undefined, { status: "valid", newCode: () => "c" });
		expect(planned.ok && planned.value.map((a) => a.data.ticketTypeId)).toEqual(["tt_pk", "tt_pk", "tt_pk"]);
	});

	it("T174f named attendees match the people: 3 names fit, 2 do not", () => {
		const names = (n: number) => Array.from({ length: n }, (_, i) => ({ ticketTypeId: "tt_pk", name: `P${i}` }));
		expect(planAttendees("bk_1", booking, names(3), { status: "valid", newCode: () => "c" }).ok).toBe(true);
		expect(planAttendees("bk_1", booking, names(2), { status: "valid", newCode: () => "c" }).ok).toBe(false);
	});

	it("T174f waiver seats (receipt refs) are one per person", () => {
		expect(seatIds("bk_1", { lines })).toEqual(["bk_1-1", "bk_1-2", "bk_1-3"]);
	});
});
