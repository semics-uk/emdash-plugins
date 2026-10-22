import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { generateToken } from "@semics-tech/shared";
import { type BudgetedHost, type BudgetResult, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The waitlist in the shipped core, in workerd (EV-FR-16, EV-US-6, R22): join a sold-out event, a
// cancel frees the seat, the `waitlist` cron offers it to the first in line as a held booking, the
// outbox emails a one-time claim link, the claim swaps the code for an access token and checkout
// continue confirms it. Every step is measured with the T007 budget harness.

let runtime: PluginRuntimeTestHost;
let budget: BudgetedHost;
let eventId = "";
let ticketTypeId = "";
const ORIGIN = "https://site.test";
const meta = (ip = "203.0.113.9") => ({ meta: { ip, userAgent: null, referer: null, geo: null } });
type Body = Record<string, unknown> & { ok?: boolean; error?: { code: string } };
type Entry = { id: string; data: Record<string, unknown> };

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
		slug: "small-gig",
		status: "published",
		data: { title: "Small Gig", starts_at: "2099-11-14T19:00:00.000Z", timezone: "UTC", venue: "Cellar" },
	});
	eventId = entry.id;
	const saved = (await runtime.transport.invokeRoute("config/save", {
		eventId,
		config: { status: "on_sale", capacity: 1, currency: "GBP", waitlistEnabled: true },
		ticketTypes: [{ name: "Entry", priceMinor: 0, capacity: 1 }],
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

async function call(route: string, input: unknown, request: unknown = meta(), limit = 10): Promise<Body> {
	const result = await budget.invokeRoute(route, input, request);
	expectWithinBudget(result, { calls: limit });
	return result.value as Body;
}

async function cron(name: string, limit = 10): Promise<BudgetResult> {
	const result = await budget.invokeHook("cron", { name, scheduledAt: new Date().toISOString() });
	expectWithinBudget(result, { calls: limit });
	return result;
}

const entries = async () => (await runtime.inspect.storage.list("waitlist")) as Entry[];
const byEmail = async (email: string) => (await entries()).find((e) => e.data.email === email);

let buyer = { bookingRef: "", accessToken: "" };

describe("waitlist journey in the shipped core (EV-FR-16, EV-US-6, R22)", () => {
	it("EV-FR-16 public/event says the event takes a waitlist", async () => {
		expect(await call("public/event", { eventId })).toMatchObject({ ok: true, waitlist: true });
	});

	it("EV-US-6 the only seat is booked, then two people join the waitlist (8 calls or fewer)", async () => {
		const held = await call("public/checkout/reserve", {
			eventId,
			lines: [{ ticketTypeId, qty: 1 }],
			buyer: { name: "First Buyer", email: "first@example.com" },
			idempotencyKey: `waitlist-key-${"q".repeat(30)}`,
		});
		buyer = { bookingRef: String(held.bookingRef), accessToken: String(held.accessToken) };
		expect(await call("public/checkout/continue", buyer)).toMatchObject({ ok: true, status: "confirmed" });

		expect(await call("public/waitlist/join", { eventId })).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		const join = (name: string, email: string) => call("public/waitlist/join", { eventId, name, email, qty: 1 }, meta(), 8);
		expect(await join("Ann Early", "ann@example.com")).toEqual({ ok: true });
		expect(await join("Bob Later", "bob@example.com")).toEqual({ ok: true });
		expect((await entries()).map((e) => e.data.status)).toEqual(["waiting", "waiting"]);
	});

	it("EV-FR-16 sold out: the waitlist tick offers nothing", async () => {
		await cron("waitlist", 8);
		expect((await entries()).map((e) => e.data.status)).toEqual(["waiting", "waiting"]);
	});

	it("EV-FR-16 a cancel frees the seat and the next tick offers it to the earliest entry, within 8 calls", async () => {
		expect(await call("public/booking/cancel", buyer)).toMatchObject({ ok: true, status: "cancelled" });
		await cron("waitlist", 8);
		const ann = await byEmail("ann@example.com");
		expect(ann?.data.status).toBe("offered");
		expect((await byEmail("bob@example.com"))?.data.status).toBe("waiting");
		const booking = (await runtime.inspect.storage.get("bookings", String(ann?.data.bookingId))) as Record<
			string,
			unknown
		>;
		expect(booking).toMatchObject({ status: "held", email: "ann@example.com", waitlistId: ann?.id });
	});

	it("EV-FR-16 the offer is emailed with a one-time claim link; a wrong code and a reuse are NOT_FOUND", async () => {
		// The first tick sends the cancellation and the offer (two per tick).
		await cron("outbox-drain");
		const mail = (await runtime.inspect.email()).map((m) => JSON.stringify(m)).find((m) => m.includes("ann@example.com"));
		expect(mail).toBeDefined();
		const ref = /[?&]ref=([0-9A-Z]{10})/.exec(mail ?? "")?.[1] ?? "";
		const code = /[?&]k=([A-Za-z0-9_-]{43})/.exec(mail ?? "")?.[1] ?? "";
		expect(mail).toContain("offer=1");
		expect(code).not.toBe("");

		expect(await call("public/waitlist/claim", { bookingRef: ref, code: generateToken() })).toMatchObject({
			ok: false,
			error: { code: "NOT_FOUND" },
		});
		// The buyer's booking is no waitlist offer: its own link cannot claim anything.
		expect(await call("public/waitlist/claim", { bookingRef: buyer.bookingRef, code })).toMatchObject({ ok: false });
		const claimed = await call("public/waitlist/claim", { bookingRef: ref, code });
		expect(claimed).toMatchObject({ ok: true, bookingRef: ref, accessToken: expect.any(String) });
		expect(await call("public/waitlist/claim", { bookingRef: ref, code })).toMatchObject({ ok: false });
		expect((await byEmail("ann@example.com"))?.data.status).toBe("claimed");

		const done = await call("public/checkout/continue", { bookingRef: ref, accessToken: String(claimed.accessToken) });
		expect(done).toMatchObject({ ok: true, status: "confirmed" });
	});

	it("EV-US-6 the join limit is per connection", async () => {
		const ip = "198.51.100.77";
		const codes: string[] = [];
		for (let i = 0; i < 6; i++) {
			const out = await call("public/waitlist/join", { eventId, name: "P", email: `p${i}@example.com`, qty: 1 }, meta(ip));
			codes.push(out.ok ? "ok" : String(out.error?.code));
		}
		expect(codes).toEqual(["ok", "ok", "ok", "ok", "ok", "RATE_LIMITED"]);
	});
});
