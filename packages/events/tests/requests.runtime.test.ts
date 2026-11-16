import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// T174a in the real sandbox: a booking request (a date and a window, no time yet) waits for approval;
// on the Bookings page its Approve opens "Confirm time" (date and start defaulting to the request),
// and `bookings.confirm:<id>` confirms it with the agreed time in the same guarded write.

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function setup() {
	runtime = await createPluginRuntimeTestHost();
	const r = runtime;
	const counted = { capacity: 100, reserved: 2, sold: 0 };
	await r.fixtures.plugin.storage("event_configs", "ev1", {
		status: "on_sale",
		...counted,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: false,
		requests: {
			windows: [{ id: "am", label: "AM", start: "10:00", end: "12:00" }],
			days: ["SA"],
			aheadDays: 365,
			noticeDays: 0,
			closedDates: [],
		},
		info: { title: "Quad trek", startsAt: future(-100), endsAt: null, timezone: "Europe/London", venue: null },
	});
	await r.fixtures.plugin.storage("ticket_types", "tt_a", {
		eventId: "ev1",
		name: "Party",
		priceMinor: 0,
		...counted,
		hidden: false,
		sort: 0,
	});
	await r.fixtures.plugin.storage("bookings", "bk_1", {
		ref: "REFONE",
		eventId: "ev1",
		status: "awaiting_approval",
		holdExpiresAt: future(24),
		holdCeilingAt: future(-1),
		releaseClaimedAt: null,
		email: "ada@example.com",
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		lines: [{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 0 }],
		totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
		answers: {},
		request: { date: "2027-12-11", window: "am" },
		approval: { until: future(24) },
		accessTokenHash: "h",
		createdAt: future(-1),
	});
	return { r, budget: withBudget(r) };
}

describe("T174a Confirm time on the Bookings page", () => {
	it("T174a a request shows what was asked for, and its Approve asks for the time", async () => {
		const { r } = await setup();
		const page = JSON.stringify((await r.admin.loadPage("/bookings")).blocks);
		expect(page).toContain("Requested: Sat 11 Dec, AM");
		expect(page).toContain("bookings.time_ask");

		const ask = await r.admin.act("/bookings", "bookings.time_ask", {
			value: { id: "bk_1", d: "2027-12-11", s: "10:00", z: "Europe/London" },
		});
		const form = JSON.stringify(ask.blocks);
		expect(form).toContain("bookings.confirm:bk_1");
		expect(form).toContain("Confirm time");
		expect(form).toContain("2027-12-11");
		expect(form).toContain("10:00");
	});

	it("T174a a plain approve of a request is refused: it needs a time", async () => {
		const { r } = await setup();
		const out = await r.admin.act("/bookings", "bookings.approve", { value: "bk_1" });
		expect(JSON.stringify(out.blocks)).toContain("Not changed");
	});

	it("T174a bookings.confirm writes the agreed time with the confirm, within budget", async () => {
		const { r, budget } = await setup();
		const confirmed = await budget.invokeRoute("admin", {
			type: "form_submit",
			action_id: "bookings.confirm:bk_1",
			block_id: "Europe/London",
			values: { date: "2027-12-11", start: "10:30", end: "12:15" },
		});
		expectWithinBudget(confirmed, { calls: 9 });
		expect(JSON.stringify(confirmed.value)).toContain("REFONE: confirmed");
		const stored = JSON.stringify(await r.inspect.storage.list("bookings"));
		expect(stored).toContain('"status":"confirmed"');
		expect(stored).toContain('"time":{"startsAt":"2027-12-11T10:30:00.000Z","endsAt":"2027-12-11T12:15:00.000Z"}');
		expect(JSON.stringify(await r.inspect.storage.list("outbox"))).toContain("booking_confirmed");
	});

	it("T174a a time that does not parse confirms nothing", async () => {
		const { r } = await setup();
		const out = await r.admin.submit("/bookings", "bookings.confirm:bk_1", { date: "2027-12-11", start: "soon" });
		expect(JSON.stringify(out.blocks)).toContain("Not changed");
		expect(JSON.stringify(await r.inspect.storage.list("bookings"))).toContain('"status":"awaiting_approval"');
	});
});
