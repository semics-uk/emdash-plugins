import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// public/checkout/continue (EV-FR-05, EV-FR-07, R9, R22) against the real plugin in workerd.
// Expiry and race paths need a clock and are covered with fakes in tests/routes/checkout-continue.test.ts.

let runtime: PluginRuntimeTestHost | undefined;

afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const ROUTE = "public/checkout/continue";
/** The common order (one ticket type, no occurrence) meets the R22 design target. */
const TARGET = { calls: 8 };
const meta = { meta: { ip: "203.0.113.7", userAgent: null, referer: null, geo: null } };

type Body = {
	ok: boolean;
	error?: { code: string };
	issues?: Array<{ path: string; code: string }>;
	bookingRef?: string;
	accessToken?: string;
	status?: string;
	next?: { type: string; bookingRef?: string };
};
type Counted = { capacity: number; reserved: number; sold: number };
type Attendee = { bookingId: string; ticketTypeId: string; name: string; email: string; code: string; status: string };

interface Setup {
	runtime: PluginRuntimeTestHost;
	budget: BudgetedHost;
	types: Record<string, string>;
	occurrenceId?: string;
}

async function setup({ occurrences = false, price = 0 }: { occurrences?: boolean; price?: number } = {}) {
	runtime = await createPluginRuntimeTestHost();
	const saved = (await runtime.transport.invokeRoute("config/save", {
		eventId: "entry_1",
		config: { status: "on_sale", capacity: 50, currency: "GBP" },
		ticketTypes: [
			{ name: "Adult", priceMinor: price, capacity: 50 },
			{ name: "Child", priceMinor: 0, capacity: 50, sort: 1 },
		],
		occurrences: occurrences
			? [{ startsAt: "2099-12-05T18:00:00Z", endsAt: "2099-12-05T22:00:00Z", capacity: 50 }]
			: [],
	})) as { ok: boolean };
	expect(saved.ok).toBe(true);
	const loaded = (await runtime.transport.invokeRoute("config/get", { eventId: "entry_1" })) as {
		ticketTypes: Array<{ id: string; name: string }>;
		occurrences: Array<{ id: string }>;
	};
	const s: Setup = {
		runtime,
		budget: withBudget(runtime),
		types: Object.fromEntries(loaded.ticketTypes.map((t) => [t.name, t.id])),
		...(loaded.occurrences[0] ? { occurrenceId: loaded.occurrences[0].id } : {}),
	};
	return s;
}

let keySeq = 0;
const newKey = () => `continue-key-${String(++keySeq).padStart(4, "0")}-${"y".repeat(24)}`;

async function reserve(s: Setup, over: Record<string, unknown> = {}) {
	const body = (await s.runtime.transport.invokeRoute(
		"public/checkout/reserve",
		{
			eventId: "entry_1",
			lines: [{ ticketTypeId: s.types.Adult, qty: 2 }],
			buyer: { name: "Ada Lovelace", email: "ada@example.com" },
			idempotencyKey: newKey(),
			...over,
		},
		meta,
	)) as Body;
	expect(body).toMatchObject({ ok: true, status: "held" });
	return { bookingRef: body.bookingRef as string, accessToken: body.accessToken as string };
}

async function next(s: Setup, input: unknown) {
	const result = await s.budget.invokeRoute(ROUTE, input, meta);
	expectWithinBudget(result);
	return { result, body: result.value as Body };
}

const attendees = (s: Setup) => [
	{ ticketTypeId: s.types.Adult, name: "Ada Lovelace" },
	{ ticketTypeId: s.types.Adult, name: "Charles Babbage", email: "Charles@Example.com" },
];

const snapshot = async (s: Setup) => ({
	bookings: await s.runtime.inspect.storage.list("bookings"),
	attendees: await s.runtime.inspect.storage.list("attendees"),
	outbox: await s.runtime.inspect.storage.list("outbox"),
	ticketTypes: await s.runtime.inspect.storage.list("ticket_types"),
	events: await s.runtime.inspect.storage.list("event_configs"),
});

describe("public/checkout/continue (EV-FR-05, EV-FR-07)", () => {
	it("EV-FR-07 a free booking reaches confirmed: attendees written, seats sold, confirmation queued", async () => {
		const s = await setup();
		const held = await reserve(s);
		const { result, body } = await next(s, { ...held, attendees: attendees(s) });
		expectWithinBudget(result, TARGET);
		expect(body).toEqual({
			ok: true,
			bookingRef: held.bookingRef,
			status: "confirmed",
			next: { type: "done", bookingRef: held.bookingRef },
		});

		const [booking] = await s.runtime.inspect.storage.list<{ status: string; confirmedAt: string }>("bookings");
		expect(booking?.data.status).toBe("confirmed");
		expect(Date.parse(booking?.data.confirmedAt ?? "")).toBeGreaterThan(0);

		const people = (await s.runtime.inspect.storage.list<Attendee>("attendees")).map((a) => a.data);
		expect(people.map((a) => [a.name, a.email, a.status, a.ticketTypeId])).toEqual([
			["Ada Lovelace", "ada@example.com", "valid", s.types.Adult],
			["Charles Babbage", "charles@example.com", "valid", s.types.Adult],
		]);
		expect(new Set(people.map((a) => a.code)).size).toBe(2);
		expect(people.every((a) => a.bookingId === booking?.id && a.code.length >= 20)).toBe(true);

		const outbox = await s.runtime.inspect.storage.list<{ kind: string; to: string; status: string }>("outbox");
		expect(outbox.map((o) => [o.data.kind, o.data.to, o.data.status])).toEqual([
			["booking_confirmed", "ada@example.com", "pending"],
		]);
		// The access token never reaches storage in plain text.
		expect(JSON.stringify(await snapshot(s))).not.toContain(held.accessToken);

		const adult = await s.runtime.inspect.storage.get<Counted>("ticket_types", s.types.Adult as string);
		expect([adult?.reserved, adult?.sold]).toEqual([2, 2]);
		const event = await s.runtime.inspect.storage.get<Counted>("event_configs", "entry_1");
		expect([event?.reserved, event?.sold]).toEqual([2, 2]);
	});

	it("EV-FR-07 without attendee details every seat is in the buyer's name", async () => {
		const s = await setup();
		const held = await reserve(s);
		const { body } = await next(s, held);
		expect(body.status).toBe("confirmed");
		const people = (await s.runtime.inspect.storage.list<Attendee>("attendees")).map((a) => a.data.name);
		expect(people).toEqual(["Ada Lovelace", "Ada Lovelace"]);
	});

	it("EV-FR-07 replaying continue changes nothing", async () => {
		const s = await setup();
		const held = await reserve(s);
		const first = await next(s, { ...held, attendees: attendees(s) });
		expect(first.body.status).toBe("confirmed");
		const before = await snapshot(s);
		const again = await next(s, { ...held, attendees: [...attendees(s)].reverse() });
		expectWithinBudget(again.result, { calls: 2 });
		expect(again.body).toEqual(first.body);
		expect(await snapshot(s)).toEqual(before);
	});

	it("EV-FR-05 an occurrence order with two ticket types stays within 10 calls", async () => {
		const s = await setup({ occurrences: true });
		const held = await reserve(s, {
			occurrenceId: s.occurrenceId,
			lines: [
				{ ticketTypeId: s.types.Adult, qty: 1 },
				{ ticketTypeId: s.types.Child, qty: 1 },
			],
		});
		const { body } = await next(s, held);
		expect(body.status).toBe("confirmed");
		const occurrence = await s.runtime.inspect.storage.get<Counted>("occurrences", s.occurrenceId as string);
		expect(occurrence?.sold).toBe(2);
	});

	it("EV-FR-05 a wrong or missing token, or an unknown ref, is a 404 that changes nothing", async () => {
		const s = await setup();
		const held = await reserve(s);
		const before = await snapshot(s);
		const wrong = `${held.accessToken.slice(0, -1)}${held.accessToken.endsWith("A") ? "B" : "A"}`;
		for (const input of [
			{ bookingRef: held.bookingRef, accessToken: wrong },
			{ bookingRef: "0000000000", accessToken: held.accessToken },
		]) {
			const { body } = await next(s, input);
			expect(body).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		}
		const { body: missing } = await next(s, { bookingRef: held.bookingRef });
		expect(missing).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		expect(await snapshot(s)).toEqual(before);
	});

	it("EV-FR-05 bad input is refused before any storage call", async () => {
		const s = await setup();
		const held = await reserve(s);
		for (const input of [undefined, {}, { ...held, extra: 1 }, { ...held, attendees: [{ name: "" }] }]) {
			const { result, body } = await next(s, input);
			expect(body).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
			expect(result.calls).toEqual([]);
		}
	});

	it("EV-FR-07 attendees must match the booked seats", async () => {
		const s = await setup();
		const held = await reserve(s);
		const before = await snapshot(s);
		const { body } = await next(s, { ...held, attendees: [{ ticketTypeId: s.types.Child, name: "Kid" }] });
		expect(body).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" }, issues: [{ path: "attendees" }] });
		expect(await snapshot(s)).toEqual(before);
	});

	it("EV-FR-05 the response carries no other booking's data", async () => {
		const s = await setup();
		const other = await reserve(s, { buyer: { name: "Grace Hopper", email: "grace@example.com" } });
		const mine = await reserve(s);
		const { body } = await next(s, mine);
		const text = JSON.stringify(body);
		expect(text).not.toContain(other.bookingRef);
		expect(text).not.toContain("grace");
		expect(Object.keys(body).sort()).toEqual(["bookingRef", "next", "ok", "status"]);
		const { body: theirs } = await next(s, { bookingRef: other.bookingRef, accessToken: mine.accessToken });
		expect(theirs).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
	});

	it("EV-FR-05 a paid booking is not confirmed by the Free edition (no payment provider)", async () => {
		const s = await setup({ price: 1500 });
		const held = await reserve(s);
		const before = await snapshot(s);
		const { body } = await next(s, held);
		expect(body).toMatchObject({ ok: false, error: { code: "PAYMENT_FAILED" } });
		expect(await snapshot(s)).toEqual(before);
	});
});
