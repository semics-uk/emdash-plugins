import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { generateToken } from "@semics-tech/shared";
import { type BudgetedHost, type BudgetResult, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PUBLIC_ROUTES } from "../src/routes/public";

// T057 phase-2 gate (EV-NFR-01, R22): every public route of the shipped core, and every admin page
// load, measured with the T007 harness in workerd. Each path a visitor can take (happy, refusal,
// wrong token) stays within the hard limit of 10 bridge calls, log calls included. One host is
// shared and the routes run in journey order: reserve, continue, status, calendar, redeem, cancel.

let runtime: PluginRuntimeTestHost;
let budget: BudgetedHost;
let eventId = "";
let ticketTypeId = "";
const exercised = new Set<string>();
const meta = { meta: { ip: "203.0.113.9", userAgent: null, referer: null, geo: null } };
const ORIGIN = "https://site.test";

type Body = Record<string, unknown> & { ok?: boolean; error?: { code: string } };

beforeAll(async () => {
	runtime = await createPluginRuntimeTestHost({ site: { name: "Town Hall", url: ORIGIN } });
	budget = withBudget(runtime);
	await runtime.fixtures.collection({
		slug: "events",
		label: "Events",
		fields: [
			{ slug: "title", label: "Title", type: "string" },
			{ slug: "starts_at", label: "Starts", type: "datetime" },
			{ slug: "ends_at", label: "Ends", type: "datetime" },
			{ slug: "timezone", label: "Timezone", type: "string" },
			{ slug: "venue", label: "Venue", type: "string" },
		],
	});
	const entry = await runtime.fixtures.content("events", {
		slug: "winter-concert",
		status: "published",
		data: {
			title: "Winter Concert",
			starts_at: "2099-11-14T19:00:00.000Z",
			ends_at: "2099-11-14T21:00:00.000Z",
			timezone: "Europe/London",
			venue: "Town Hall",
		},
	});
	eventId = entry.id;
	const saved = (await runtime.transport.invokeRoute("config/save", {
		eventId,
		config: { status: "on_sale", capacity: 50, currency: "GBP" },
		ticketTypes: [{ name: "Adult", priceMinor: 0, capacity: 50 }],
		occurrences: [],
	})) as { ok: boolean };
	expect(saved.ok).toBe(true);
	const loaded = (await runtime.transport.invokeRoute("config/get", { eventId })) as {
		ticketTypes: Array<{ id: string }>;
	};
	ticketTypeId = loaded.ticketTypes[0]?.id ?? "";
});

afterAll(async () => {
	await runtime?.dispose();
});

async function call(route: string, input: unknown, request: unknown = meta): Promise<BudgetResult> {
	exercised.add(route);
	const result = await budget.invokeRoute(route, input, request);
	expectWithinBudget(result);
	return result;
}

const body = (r: BudgetResult) => r.value as Body;
const rawText = (r: BudgetResult) => (r.value as { body?: { value?: string } }).body?.value ?? "";
const rawStatus = (r: BudgetResult) => (r.value as { status?: number }).status;
const get = (query: string) => ({ ...meta, url: `${ORIGIN}/x?${query}`, method: "GET" });

let bookingRef = "";
let accessToken = "";

describe("T057 every public route stays within 10 bridge calls (EV-NFR-01, R22)", () => {
	it("EV-NFR-01 public/events and public/event (with the schedule check)", async () => {
		expect((body(await call("public/events", {})).events as unknown[]).length).toBe(1);
		expect(body(await call("public/event", { eventId }))).toMatchObject({ ok: true, eventId });
		expect(body(await call("public/event", { eventId: "missing" }))).toMatchObject({ ok: false });
	});

	it("EV-NFR-01 public/checkout/reserve: bad input, a reservation and its resubmit", async () => {
		expect(body(await call("public/checkout/reserve", { eventId }))).toMatchObject({ ok: false });
		const order = {
			eventId,
			lines: [{ ticketTypeId, qty: 2 }],
			buyer: { name: "Ada Lovelace", email: "ada@example.com" },
			idempotencyKey: `budget-key-${"z".repeat(30)}`,
		};
		const held = body(await call("public/checkout/reserve", order));
		expect(held).toMatchObject({ ok: true, status: "held" });
		expect(body(await call("public/checkout/reserve", order))).toMatchObject({ ok: true, status: "held" });
		bookingRef = String(held.bookingRef);
		accessToken = String(body(await call("public/checkout/reserve", order)).accessToken);
	});

	it("EV-NFR-01 public/checkout/continue: wrong token, confirm, replay", async () => {
		const wrong = body(await call("public/checkout/continue", { bookingRef, accessToken: generateToken() }));
		expect(wrong).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		const done = body(await call("public/checkout/continue", { bookingRef, accessToken }));
		expect(done).toMatchObject({ ok: true, status: "confirmed" });
		expect(body(await call("public/checkout/continue", { bookingRef, accessToken }))).toMatchObject({ ok: true });
	});

	it("EV-NFR-01 public/booking and both calendar routes", async () => {
		expect(body(await call("public/booking", { bookingRef, accessToken: generateToken() }))).toMatchObject({
			ok: false,
			error: { code: "NOT_FOUND" },
		});
		const status = body(await call("public/booking", { bookingRef, accessToken }));
		expect(status).toMatchObject({ ok: true, status: "confirmed" });
		const query = (status.calendar as { query: string }).query;
		const ics = await call("public/booking/ics", {}, get(query));
		expect(rawStatus(ics)).toBe(200);
		expect(rawText(ics)).toContain("BEGIN:VCALENDAR");
		expect(rawStatus(await call("public/booking/ics", {}, get(`ref=${bookingRef}`)))).toBe(401);
		const event = await call("public/event/ics", {}, get(`eventId=${eventId}`));
		expect(rawStatus(event)).toBe(200);
	});

	it("EV-NFR-01 the outbox drain and public/booking/redeem: a wrong code, the code, a reuse", async () => {
		const tick = await budget.invokeHook("cron", { name: "outbox-drain", scheduledAt: new Date().toISOString() });
		expectWithinBudget(tick);
		const mail = JSON.stringify(await runtime.inspect.email());
		const code = /[?&]k=([A-Za-z0-9_-]{43})/.exec(mail)?.[1] ?? "";
		expect(code).not.toBe("");
		expect(body(await call("public/booking/redeem", { bookingRef, code: generateToken() }))).toMatchObject({
			ok: false,
			error: { code: "NOT_FOUND" },
		});
		const redeemed = body(await call("public/booking/redeem", { bookingRef, code }));
		expect(redeemed).toMatchObject({ ok: true, bookingRef });
		accessToken = String(redeemed.accessToken);
		expect(body(await call("public/booking/redeem", { bookingRef, code }))).toMatchObject({ ok: false });
	});

	it("EV-NFR-01 public/booking/cancel: wrong token, cancel, replay", async () => {
		const wrong = body(await call("public/booking/cancel", { bookingRef, accessToken: generateToken() }));
		expect(wrong).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		expect(body(await call("public/booking/cancel", { bookingRef, accessToken }))).toMatchObject({
			ok: true,
			status: "cancelled",
		});
		expect(body(await call("public/booking/cancel", { bookingRef, accessToken }))).toMatchObject({ ok: true });
	});

	it("EV-NFR-01 the routes declared for later phases answer NOT_FOUND within budget", async () => {
		for (const route of ["public/waitlist/join", "public/waitlist/claim", "webhooks/stripe", "signatures/receipt"]) {
			expect(body(await call(route, {})), route).toMatchObject({ ok: false });
		}
	});

	it("T057 every declared public route was exercised above", () => {
		expect([...exercised].sort()).toEqual(Object.keys(PUBLIC_ROUTES).sort());
	});
});

describe("T057 every admin page load stays within 10 bridge calls, schedule check included (R22, R37)", () => {
	it.each(["/bookings", "/attendees", "/events", "/setup", "widget:sales"])("EV-NFR-01 page_load %s", async (page) => {
		const result = await budget.invokeRoute("admin", { type: "page_load", page });
		expectWithinBudget(result);
		expect((result.value as { blocks?: unknown[] }).blocks?.length ?? 0).toBeGreaterThan(0);
	});
});
