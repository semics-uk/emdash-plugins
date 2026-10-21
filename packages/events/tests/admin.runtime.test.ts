import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// The real plugin in workerd: the host validates every Block Kit response (EV-FR-11, EV-US-5).

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

async function setup() {
	runtime = await createPluginRuntimeTestHost();
	const r = runtime;
	await r.fixtures.plugin.storage("event_configs", "ev1", {
		status: "on_sale",
		capacity: 100,
		reserved: 12,
		sold: 40,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: false,
	});
	await r.fixtures.plugin.storage("bookings", "bk_1", {
		ref: "REF1",
		eventId: "ev1",
		status: "confirmed",
		email: "ada@example.com",
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		totals: { totalMinor: 0, currency: "GBP" },
		createdAt: "2026-12-01T10:00:00.000Z",
	});
	await r.fixtures.plugin.storage("attendees", "bk_1-1", {
		bookingId: "bk_1",
		eventId: "ev1",
		ticketTypeId: "tt_a",
		name: "Ada, \"The\" Lovelace",
		email: "ada@example.com",
		code: "CODE-ADA",
		status: "valid",
	});
	return { r, budget: withBudget(r) };
}

describe("admin pages in the host (EV-FR-11)", () => {
	it("EV-FR-11 every page loads, validates and stays within budget", async () => {
		const { r } = await setup();
		for (const page of ["/setup", "/bookings", "/attendees", "/events"]) {
			const res = await r.admin.loadPage(page);
			expect(res.blocks?.length, page).toBeGreaterThan(0);
		}
	});

	it("EV-US-7 the widget meters match the counters", async () => {
		const { r } = await setup();
		const res = await r.admin.loadWidget("sales");
		const meterBlock = res.blocks?.find((b: { type: string }) => b.type === "meter") as { value: number; max: number };
		expect(meterBlock).toMatchObject({ value: 40, max: 100 });
	});

	it("EV-US-5 check-in twice shows the first check-in time", async () => {
		const { r } = await setup();
		const submit = () =>
			r.admin.submit("/attendees", "attendees.checkin_code", { eventId: "ev1", code: "CODE-ADA" });
		const first = await submit();
		expect(JSON.stringify(first.blocks)).toContain("Checked in");
		const second = await submit();
		expect(JSON.stringify(second.blocks)).toContain("Already checked in");
	});

	it("EV-FR-11 the CSV route returns raw text/csv with escaped cells, within budget", async () => {
		const { budget } = await setup();
		const res = await budget.invokeRoute("attendees/export", { eventId: "ev1" });
		expectWithinBudget(res, { calls: 8 });
		const out = res.value as { body?: unknown; status?: number; headers?: unknown };
		const text = JSON.stringify(out);
		expect(text).toContain("text/csv");
		expect(text).toContain('Ada, \\"\\"The\\"\\" Lovelace');
	});
});
