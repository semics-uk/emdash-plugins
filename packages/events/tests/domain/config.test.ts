import { describe, expect, it } from "vitest";

import { type ConfigIssue, type ExistingState, validateConfigInput } from "../../src/domain/config";
import type { EventConfigDoc, OccurrenceDoc, TicketTypeDoc } from "../../src/storage/schema";

const empty: ExistingState = { config: null, ticketTypes: new Map(), occurrences: new Map() };
let n = 0;
const newId = () => `id${++n}`;

const baseConfig = { status: "on_sale", capacity: 100, currency: "GBP" };
const baseTicket = { name: "Standard", priceMinor: 1500, capacity: 50 };
const baseOcc = { startsAt: "2026-12-05T18:00:00Z", endsAt: "2026-12-06T12:00:00Z", capacity: 40 };

const validate = (input: unknown, existing: ExistingState = empty, id: () => string = newId) =>
	validateConfigInput("e1", input, existing, id);

function issues(input: unknown, existing: ExistingState = empty): ConfigIssue[] {
	const r = validate(input, existing);
	if (r.ok) throw new Error("expected rejection");
	return r.error;
}
const codes = (list: ConfigIssue[]) => list.map((i) => `${i.path}:${i.code}`);

const storedConfig: EventConfigDoc = {
	status: "on_sale",
	capacity: 100,
	reserved: 30,
	sold: 10,
	currency: "GBP",
	questions: [],
	signature: { required: false, mode: "each_attendee" },
	waitlistEnabled: false,
};
const storedTicket: TicketTypeDoc = {
	eventId: "e1",
	name: "Standard",
	priceMinor: 1500,
	capacity: 50,
	reserved: 20,
	sold: 5,
	hidden: false,
	sort: 0,
};
const storedOcc: OccurrenceDoc = {
	eventId: "e1",
	startsAt: "2026-12-05T18:00:00.000Z",
	capacity: 40,
	reserved: 8,
	sold: 2,
	status: "open",
};

describe("validateConfigInput (EV-FR-02, EV-FR-03)", () => {
	it("EV-FR-02 accepts a full valid input and fills defaults, counters at zero", () => {
		const r = validate({ config: baseConfig, ticketTypes: [baseTicket], occurrences: [baseOcc] });
		if (!r.ok) throw new Error(JSON.stringify(r.error));
		expect(r.value.config).toEqual({
			status: "on_sale",
			capacity: 100,
			reserved: 0,
			sold: 0,
			currency: "GBP",
			questions: [],
			signature: { required: false, mode: "each_attendee" },
			waitlistEnabled: false,
		});
		expect(r.value.ticketTypes).toHaveLength(1);
		expect(r.value.ticketTypes[0]?.data).toMatchObject({
			eventId: "e1",
			name: "Standard",
			priceMinor: 1500,
			reserved: 0,
			hidden: false,
			sort: 0,
		});
		expect(r.value.occurrences[0]?.data).toMatchObject({
			eventId: "e1",
			startsAt: "2026-12-05T18:00:00.000Z",
			endsAt: "2026-12-06T12:00:00.000Z",
			status: "open",
			sold: 0,
		});
	});

	it("EV-FR-02 accepts a decimal price string and converts it to minor units", () => {
		const r = validate({
			config: baseConfig,
			ticketTypes: [{ ...baseTicket, priceMinor: undefined, price: "12.50" }],
		});
		if (!r.ok) throw new Error("rejected");
		expect(r.value.ticketTypes[0]?.data.priceMinor).toBe(1250);
	});

	it("EV-FR-02 rejects invalid prices with codes", () => {
		const bads = [
			{ priceMinor: -1 },
			{ priceMinor: 12.5 },
			{ priceMinor: "10" },
			{ priceMinor: undefined, price: "1.999" },
			{ priceMinor: undefined, price: "abc" },
			{ priceMinor: undefined },
		];
		for (const bad of bads) {
			expect(codes(issues({ config: baseConfig, ticketTypes: [{ ...baseTicket, ...bad }] }))).toEqual([
				"ticketTypes[0].priceMinor:INVALID_PRICE",
			]);
		}
	});

	it("EV-FR-02 rejects invalid capacities with codes", () => {
		expect(codes(issues({ config: { ...baseConfig, capacity: 0 } }))).toEqual(["config.capacity:INVALID_CAPACITY"]);
		expect(codes(issues({ config: { ...baseConfig, capacity: 1.5 } }))).toEqual(["config.capacity:INVALID_CAPACITY"]);
		expect(codes(issues({ config: baseConfig, ticketTypes: [{ ...baseTicket, capacity: -3 }] }))).toEqual([
			"ticketTypes[0].capacity:INVALID_CAPACITY",
		]);
		expect(codes(issues({ config: baseConfig, occurrences: [{ ...baseOcc, capacity: "x" }] }))).toEqual([
			"occurrences[0].capacity:INVALID_CAPACITY",
		]);
	});

	it("EV-FR-02 rejects invalid sale windows and occurrence dates with codes", () => {
		const window = { salesStart: "2026-12-02T00:00:00Z", salesEnd: "2026-12-01T00:00:00Z" };
		expect(codes(issues({ config: { ...baseConfig, ...window } }))).toEqual(["config.salesEnd:INVALID_WINDOW"]);
		expect(codes(issues({ config: { ...baseConfig, salesStart: "next week" } }))).toEqual([
			"config.salesStart:INVALID_DATE",
		]);
		const equal = { salesStart: "2026-12-02T00:00:00Z", salesEnd: "2026-12-02T00:00:00Z" };
		expect(codes(issues({ config: baseConfig, ticketTypes: [{ ...baseTicket, ...equal }] }))).toEqual([
			"ticketTypes[0].salesEnd:INVALID_WINDOW",
		]);
		expect(
			codes(issues({ config: baseConfig, occurrences: [{ ...baseOcc, endsAt: "2026-12-05T17:00:00Z" }] })),
		).toEqual(["occurrences[0].endsAt:INVALID_WINDOW"]);
		expect(
			codes(issues({ config: baseConfig, occurrences: [{ ...baseOcc, startsAt: "2026-02-30T10:00:00Z" }] })),
		).toEqual(["occurrences[0].startsAt:INVALID_DATE"]);
		expect(codes(issues({ config: baseConfig, occurrences: [{ capacity: 5 }] }))).toEqual([
			"occurrences[0].startsAt:INVALID_DATE",
		]);
	});

	it("EV-FR-02 rejects bad currency, status, names, per-order limits and shape", () => {
		expect(codes(issues({ config: { ...baseConfig, currency: "pounds" } }))).toEqual([
			"config.currency:INVALID_CURRENCY",
		]);
		expect(codes(issues({ config: { ...baseConfig, currency: "ZZZ" } }))).toEqual(["config.currency:INVALID_CURRENCY"]);
		expect(codes(issues({ config: { ...baseConfig, status: "live" } }))).toEqual(["config.status:INVALID_STATUS"]);
		expect(codes(issues({ config: baseConfig, ticketTypes: [{ ...baseTicket, name: "  " }] }))).toEqual([
			"ticketTypes[0].name:INVALID_NAME",
		]);
		expect(
			codes(issues({ config: baseConfig, ticketTypes: [{ ...baseTicket, minPerOrder: 5, maxPerOrder: 2 }] })),
		).toEqual(["ticketTypes[0].maxPerOrder:INVALID_QUANTITY_LIMITS"]);
		expect(codes(issues({ config: baseConfig, ticketTypes: [{ ...baseTicket, minPerOrder: 0 }] }))).toEqual([
			"ticketTypes[0].minPerOrder:INVALID_QUANTITY_LIMITS",
		]);
		expect(codes(issues("nope"))).toEqual(["input:INVALID_INPUT"]);
		expect(codes(issues({ config: baseConfig, ticketTypes: "x" }))).toEqual(["ticketTypes:INVALID_INPUT"]);
		expect(codes(issues({ ticketTypes: [] }))).toEqual(["config:INVALID_INPUT"]);
	});

	it("EV-FR-02 reports every problem at once", () => {
		const list = issues({ config: { ...baseConfig, capacity: 0 }, ticketTypes: [{ ...baseTicket, priceMinor: -1 }] });
		expect(codes(list)).toEqual(["config.capacity:INVALID_CAPACITY", "ticketTypes[0].priceMinor:INVALID_PRICE"]);
	});

	it("EV-FR-02 caps the number of ticket types and occurrences", () => {
		const many = Array.from({ length: 26 }, () => baseTicket);
		expect(codes(issues({ config: baseConfig, ticketTypes: many }))).toEqual(["ticketTypes:TOO_MANY"]);
		const occ = Array.from({ length: 101 }, () => baseOcc);
		expect(codes(issues({ config: baseConfig, occurrences: occ }))).toEqual(["occurrences:TOO_MANY"]);
	});

	it("EV-FR-03 refuses to lower capacity below reserved, for config, ticket type and occurrence", () => {
		const existing: ExistingState = {
			config: storedConfig,
			ticketTypes: new Map([["t1", storedTicket]]),
			occurrences: new Map([["o1", storedOcc]]),
		};
		const list = issues(
			{
				config: { ...baseConfig, capacity: 29 },
				ticketTypes: [{ ...baseTicket, id: "t1", capacity: 19 }],
				occurrences: [{ ...baseOcc, id: "o1", capacity: 7 }],
			},
			existing,
		);
		expect(codes(list)).toEqual([
			"config.capacity:CAPACITY_BELOW_RESERVED",
			"ticketTypes[0].capacity:CAPACITY_BELOW_RESERVED",
			"occurrences[0].capacity:CAPACITY_BELOW_RESERVED",
		]);
	});

	it("EV-FR-03 allows capacity equal to reserved and keeps the stored counters", () => {
		const existing: ExistingState = {
			config: storedConfig,
			ticketTypes: new Map([["t1", storedTicket]]),
			occurrences: new Map(),
		};
		const r = validate(
			{
				config: { ...baseConfig, capacity: 30 },
				ticketTypes: [{ ...baseTicket, id: "t1", capacity: 20, reserved: 0, sold: 0 }],
			},
			existing,
		);
		if (!r.ok) throw new Error(JSON.stringify(r.error));
		expect(r.value.config).toMatchObject({ capacity: 30, reserved: 30, sold: 10 });
		expect(r.value.ticketTypes[0]).toMatchObject({ id: "t1", data: { reserved: 20, sold: 5, eventId: "e1" } });
	});

	it("EV-FR-02 rejects an unknown or duplicated id", () => {
		const existing: ExistingState = {
			config: storedConfig,
			ticketTypes: new Map([["t1", { ...storedTicket, reserved: 0, sold: 0 }]]),
			occurrences: new Map(),
		};
		expect(codes(issues({ config: baseConfig, ticketTypes: [{ ...baseTicket, id: "zzz" }] }, existing))).toEqual([
			"ticketTypes[0].id:UNKNOWN_ID",
		]);
		const dup = [
			{ ...baseTicket, id: "t1" },
			{ ...baseTicket, id: "t1" },
		];
		expect(codes(issues({ config: baseConfig, ticketTypes: dup }, existing))).toEqual([
			"ticketTypes[1].id:DUPLICATE_ID",
		]);
	});

	it("EV-FR-02 deletes items left out, unless they hold or sold seats", () => {
		const idle = { ...storedTicket, reserved: 0, sold: 0 };
		const existing: ExistingState = {
			config: storedConfig,
			ticketTypes: new Map([
				["idle", idle],
				["busy", storedTicket],
			]),
			occurrences: new Map([["o1", storedOcc]]),
		};
		expect(codes(issues({ config: baseConfig }, existing))).toEqual([
			"ticketTypes:ITEM_IN_USE",
			"occurrences:ITEM_IN_USE",
		]);
		const r = validate(
			{ config: baseConfig, ticketTypes: [{ ...baseTicket, id: "busy" }], occurrences: [{ ...baseOcc, id: "o1" }] },
			existing,
		);
		if (!r.ok) throw new Error(JSON.stringify(r.error));
		expect(r.value.deleteTicketTypeIds).toEqual(["idle"]);
		expect(r.value.deleteOccurrenceIds).toEqual([]);
	});

	it("EV-FR-02 gives new items injected ids", () => {
		const r = validate({ config: baseConfig, ticketTypes: [baseTicket, baseTicket] }, empty, () => "fixed");
		if (!r.ok) throw new Error("rejected");
		expect(r.value.ticketTypes.map((t) => t.id)).toEqual(["fixed", "fixed"]);
	});
});
