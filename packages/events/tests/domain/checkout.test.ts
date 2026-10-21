import { describe, expect, it } from "vitest";

import {
	bookingKeys,
	type CheckoutPlan,
	parseReserveInput,
	planCheckout,
	RESERVE_RATE_LIMIT,
	type ReserveInput,
	rateWindowStart,
	sameOrder,
} from "../../src/domain/checkout";
import { catalogOf } from "../../src/domain/config";
import type { EventConfigDoc, OccurrenceDoc, TicketTypeDoc } from "../../src/storage/schema";

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const KEY = "k".repeat(32);

const tt = (over: Partial<TicketTypeDoc> = {}): TicketTypeDoc => ({
	eventId: "e1",
	name: "Std",
	priceMinor: 1500,
	capacity: 10,
	reserved: 0,
	sold: 0,
	hidden: false,
	sort: 0,
	...over,
});
const occ = (over: Partial<OccurrenceDoc> = {}): OccurrenceDoc => ({
	eventId: "e1",
	startsAt: "2026-12-01T18:00:00.000Z",
	capacity: 8,
	reserved: 0,
	sold: 0,
	status: "open",
	...over,
});

function config(
	over: Partial<EventConfigDoc> = {},
	types: Record<string, TicketTypeDoc> = { tt_a: tt(), tt_b: tt({ priceMinor: 0, capacity: 5 }) },
	occurrences: Record<string, OccurrenceDoc> = {},
): EventConfigDoc {
	return {
		status: "on_sale",
		capacity: 20,
		reserved: 0,
		sold: 0,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: false,
		catalog: catalogOf(
			Object.entries(types).map(([id, data]) => ({ id, data })),
			Object.entries(occurrences).map(([id, data]) => ({ id, data })),
		),
		...over,
	};
}

const input = (over: Partial<ReserveInput> = {}): ReserveInput => ({
	eventId: "e1",
	lines: [{ ticketTypeId: "tt_a", qty: 2 }],
	buyer: { name: "Ada", email: "Ada@Example.com" },
	idempotencyKey: KEY,
	...over,
});

const planned = (r: ReturnType<typeof planCheckout>): CheckoutPlan => {
	if (!r.ok) throw new Error(`plan failed: ${JSON.stringify(r.error)}`);
	return r.value;
};

describe("parseReserveInput (zod)", () => {
	it("accepts a valid request and normalises the email", () => {
		const r = parseReserveInput({ ...input(), turnstileToken: "tok" });
		expect(r).toMatchObject({ ok: true, value: { eventId: "e1", buyer: { email: "ada@example.com" } } });
	});

	it("rejects missing or malformed fields with issue paths", () => {
		const bad = [
			{},
			{ ...input(), eventId: "" },
			{ ...input(), lines: [] },
			{ ...input(), lines: [{ ticketTypeId: "tt_a", qty: 0 }] },
			{ ...input(), lines: [{ ticketTypeId: "tt_a", qty: 1.5 }] },
			{ ...input(), buyer: { name: "Ada", email: "not-an-email" } },
			{ ...input(), buyer: { name: "", email: "a@b.co" } },
			{ ...input(), idempotencyKey: "short" },
			{ ...input(), idempotencyKey: `${"x".repeat(31)}/` },
			{ ...input(), accessToken: "x" },
		];
		for (const raw of bad) {
			const r = parseReserveInput(raw);
			expect(r.ok, JSON.stringify(raw)).toBe(false);
			if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
		}
		const r = parseReserveInput({ ...input(), lines: [] });
		expect(!r.ok && r.error[0]?.path).toBe("lines");
	});
});

describe("bookingKeys (idempotency)", () => {
	it("derives a stable id and short ref from the key, different keys giving different ones", async () => {
		const a = await bookingKeys(KEY);
		expect(await bookingKeys(KEY)).toEqual(a);
		expect(a.id).toMatch(/^bk_[0-9a-f]{32}$/);
		expect(a.ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
		const b = await bookingKeys("z".repeat(32));
		expect(b.id).not.toBe(a.id);
		expect(b.ref).not.toBe(a.ref);
		expect(a.id).not.toContain(KEY);
	});
});

describe("planCheckout (EV-FR-05)", () => {
	it("prices the lines from the catalog and plans the reservation steps", () => {
		const p = planned(
			planCheckout(
				"e1",
				config(),
				input({
					lines: [
						{ ticketTypeId: "tt_b", qty: 1 },
						{ ticketTypeId: "tt_a", qty: 2 },
					],
				}),
				NOW,
				{ maxSteps: 4 },
			),
		);
		expect(p.lines).toEqual([
			{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 1500 },
			{ ticketTypeId: "tt_b", qty: 1, unitPriceMinor: 0 },
		]);
		expect(p.totals).toEqual({ subtotalMinor: 3000, discountMinor: 0, totalMinor: 3000, currency: "GBP" });
		expect(p.paid).toBe(true);
		expect(p.steps.map((s) => [s.collection, s.id, s.qty, s.capacity])).toEqual([
			["ticket_types", "tt_a", 2, 10],
			["ticket_types", "tt_b", 1, 5],
			["event_configs", "e1", 3, 20],
		]);
	});

	it("a free order is not paid", () => {
		const p = planned(
			planCheckout("e1", config(), input({ lines: [{ ticketTypeId: "tt_b", qty: 1 }] }), NOW, { maxSteps: 4 }),
		);
		expect(p.paid).toBe(false);
	});

	it("includes the occurrence step, and requires an open, future occurrence when the event has them", () => {
		const c = config({}, { tt_a: tt() }, { occ_1: occ(), occ_old: occ({ startsAt: "2026-10-01T18:00:00.000Z" }) });
		const p = planned(planCheckout("e1", c, input({ occurrenceId: "occ_1" }), NOW, { maxSteps: 4 }));
		expect(p.steps.map((s) => s.collection)).toEqual(["ticket_types", "occurrences", "event_configs"]);
		expect(planCheckout("e1", c, input(), NOW, { maxSteps: 4 })).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST", reason: "OCCURRENCE_REQUIRED" },
		});
		expect(planCheckout("e1", c, input({ occurrenceId: "nope" }), NOW, { maxSteps: 4 })).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST", reason: "UNKNOWN_OCCURRENCE" },
		});
		expect(planCheckout("e1", c, input({ occurrenceId: "occ_old" }), NOW, { maxSteps: 4 })).toMatchObject({
			ok: false,
			error: { code: "SALES_CLOSED" },
		});
		const closed = config({}, { tt_a: tt() }, { occ_1: occ({ status: "closed" }) });
		expect(planCheckout("e1", closed, input({ occurrenceId: "occ_1" }), NOW, { maxSteps: 4 })).toMatchObject({
			ok: false,
			error: { code: "SALES_CLOSED" },
		});
		expect(planCheckout("e1", config(), input({ occurrenceId: "occ_1" }), NOW, { maxSteps: 4 })).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST", reason: "UNKNOWN_OCCURRENCE" },
		});
	});

	it("answers SALES_CLOSED outside the event or ticket sales window, or when not on sale", () => {
		const closed = (c: EventConfigDoc) => planCheckout("e1", c, input(), NOW, { maxSteps: 4 });
		for (const status of ["draft", "paused", "closed", "cancelled"] as const) {
			expect(closed(config({ status }))).toMatchObject({ ok: false, error: { code: "SALES_CLOSED" } });
		}
		expect(closed(config({ salesStart: "2026-11-02T00:00:00.000Z" }))).toMatchObject({
			ok: false,
			error: { code: "SALES_CLOSED" },
		});
		expect(closed(config({ salesEnd: "2026-11-01T11:59:59.000Z" }))).toMatchObject({
			ok: false,
			error: { code: "SALES_CLOSED" },
		});
		expect(closed(config({}, { tt_a: tt({ salesEnd: "2026-11-01T00:00:00.000Z" }) }))).toMatchObject({
			ok: false,
			error: { code: "SALES_CLOSED" },
		});
		expect(closed(config({}, { tt_a: tt({ salesStart: "2026-11-05T00:00:00.000Z" }) }))).toMatchObject({
			ok: false,
			error: { code: "SALES_CLOSED" },
		});
		expect(closed(config({ salesStart: "2026-10-01T00:00:00.000Z", salesEnd: null })).ok).toBe(true);
	});

	it("refuses hidden, unknown, over-limit and under-minimum lines", () => {
		const reason = (c: EventConfigDoc, i: ReserveInput) => {
			const r = planCheckout("e1", c, i, NOW, { maxSteps: 4 });
			return r.ok ? "ok" : r.error.code === "BAD_REQUEST" ? r.error.reason : r.error.code;
		};
		expect(reason(config({}, { tt_a: tt({ hidden: true }) }), input())).toBe("UNKNOWN_TICKET_TYPE");
		expect(reason(config(), input({ lines: [{ ticketTypeId: "nope", qty: 1 }] }))).toBe("UNKNOWN_TICKET_TYPE");
		expect(reason(config({}, { tt_a: tt({ maxPerOrder: 1 }) }), input())).toBe("INVALID_QUANTITY");
		expect(reason(config({}, { tt_a: tt({ minPerOrder: 3 }) }), input())).toBe("INVALID_QUANTITY");
		// Repeated lines count together against the limits.
		const twice = input({
			lines: [
				{ ticketTypeId: "tt_a", qty: 1 },
				{ ticketTypeId: "tt_a", qty: 1 },
			],
		});
		expect(reason(config({}, { tt_a: tt({ maxPerOrder: 1 }) }), twice)).toBe("INVALID_QUANTITY");
		expect(reason(config({ catalog: null }), input())).toBe("UNKNOWN_TICKET_TYPE");
	});

	it("answers SOLD_OUT before any write when the event or a ticket type cannot fit the order", () => {
		expect(planCheckout("e1", config({ reserved: 19 }), input(), NOW, { maxSteps: 4 })).toMatchObject({
			ok: false,
			error: { code: "SOLD_OUT" },
		});
		expect(
			planCheckout("e1", config(), input({ lines: [{ ticketTypeId: "tt_b", qty: 6 }] }), NOW, { maxSteps: 4 }),
		).toMatchObject({
			ok: false,
			error: { code: "SOLD_OUT" },
		});
	});

	it("R22 refuses an order whose reservation steps exceed the budget", () => {
		const two = input({
			lines: [
				{ ticketTypeId: "tt_a", qty: 1 },
				{ ticketTypeId: "tt_b", qty: 1 },
			],
		});
		expect(planCheckout("e1", config(), two, NOW, { maxSteps: 3 }).ok).toBe(true);
		expect(planCheckout("e1", config(), two, NOW, { maxSteps: 2 })).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST", reason: "TOO_MANY_LINES" },
		});
	});
});

describe("sameOrder (duplicate submits)", () => {
	const booking = {
		eventId: "e1",
		email: "ada@example.com",
		lines: [{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 1500 }],
	};
	it("matches a resubmit of the same order, whatever the line order or email case", () => {
		const parsed = parseReserveInput(input());
		if (!parsed.ok) throw new Error("bad input");
		expect(sameOrder(booking, parsed.value)).toBe(true);
		expect(
			sameOrder(
				{
					...booking,
					lines: [
						{ ticketTypeId: "tt_b", qty: 1, unitPriceMinor: 0 },
						{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 1500 },
					],
				},
				input({
					buyer: { name: "Ada", email: "ada@example.com" },
					lines: [
						{ ticketTypeId: "tt_a", qty: 1 },
						{ ticketTypeId: "tt_b", qty: 1 },
						{ ticketTypeId: "tt_a", qty: 1 },
					],
				}),
			),
		).toBe(true);
	});
	it("rejects a different event, occurrence, buyer or quantity", () => {
		const i = input({ buyer: { name: "Ada", email: "ada@example.com" } });
		expect(sameOrder({ ...booking, eventId: "e2" }, i)).toBe(false);
		expect(sameOrder({ ...booking, occurrenceId: "occ_1" }, i)).toBe(false);
		expect(sameOrder({ ...booking, email: "bob@example.com" }, i)).toBe(false);
		expect(sameOrder(booking, input({ ...i, lines: [{ ticketTypeId: "tt_a", qty: 3 }] }))).toBe(false);
	});
});

describe("rate limit window", () => {
	it("is a sliding window ending now", () => {
		expect(rateWindowStart(NOW)).toBe(new Date(NOW - RESERVE_RATE_LIMIT.windowMs).toISOString());
		expect(RESERVE_RATE_LIMIT.limit).toBeGreaterThan(1);
	});
});
