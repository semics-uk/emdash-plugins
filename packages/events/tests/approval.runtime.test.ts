import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// Booking approval in the real sandbox (T131, R95): the private approve/decline routes and the
// Bookings page buttons, validated by the host and within the bridge-call budget.

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
		approval: { required: true, deadlineHours: 48 },
	});
	await r.fixtures.plugin.storage("ticket_types", "tt_a", {
		eventId: "ev1",
		name: "Standard",
		priceMinor: 0,
		...counted,
		hidden: false,
		sort: 0,
	});
	for (const id of ["bk_1", "bk_2"]) {
		await r.fixtures.plugin.storage("bookings", id, {
			ref: id === "bk_1" ? "REFONE" : "REFTWO",
			eventId: "ev1",
			status: "awaiting_approval",
			holdExpiresAt: future(24),
			holdCeilingAt: future(-1),
			releaseClaimedAt: null,
			email: "ada@example.com",
			buyer: { name: "Ada Lovelace", email: "ada@example.com" },
			lines: [{ ticketTypeId: "tt_a", qty: 1, unitPriceMinor: 0 }],
			totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
			answers: {},
			approval: { until: future(24) },
			accessTokenHash: "h",
			createdAt: future(-1),
		});
	}
	return { r, budget: withBudget(r) };
}

describe("T131 approval admin routes", () => {
	it("T131 bookings/approve and bookings/decline act within budget", async () => {
		const { r, budget } = await setup();
		const approved = await budget.invokeRoute("bookings/approve", { bookingId: "bk_1" });
		expectWithinBudget(approved, { calls: 8 });
		expect(approved.value).toMatchObject({ ok: true, status: "confirmed" });
		const declined = await budget.invokeRoute("bookings/decline", { bookingId: "bk_2", reason: "Full" });
		expectWithinBudget(declined, { calls: 8 });
		expect(declined.value).toMatchObject({ ok: true, status: "declined" });
		const outbox = await r.inspect.storage.list("outbox");
		expect(JSON.stringify(outbox)).toContain("booking_declined");
	});

	it("T131 the routes refuse bad input", async () => {
		const { budget } = await setup();
		const res = await budget.invokeRoute("bookings/approve", { bookingId: 7 });
		expect(res.value).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
	});
});

describe("T131 Bookings page", () => {
	it("T131 a booking awaiting approval has Approve and Decline; both validate and stay within budget", async () => {
		const { r, budget } = await setup();
		const page = await r.admin.loadPage("/bookings");
		const text = JSON.stringify(page.blocks);
		expect(text).toContain("bookings.approve");
		expect(text).toContain("bookings.decline_ask");

		const ask = await r.admin.act("/bookings", "bookings.decline_ask", { value: "bk_2" });
		expect(JSON.stringify(ask.blocks)).toContain("bookings.decline:bk_2");

		const interactions = [
			{ type: "block_action", action_id: "bookings.approve", value: "bk_1" },
			{ type: "form_submit", action_id: "bookings.decline:bk_2", values: { reason: "Full" } },
		];
		for (const i of interactions) {
			const res = await budget.invokeRoute("admin", i);
			expectWithinBudget(res, { calls: 9 });
		}
		const after = await r.admin.submit("/bookings", "bookings.search", { q: "REFTWO", status: "" });
		expect(JSON.stringify(after.blocks)).toContain("declined");
	});
});
