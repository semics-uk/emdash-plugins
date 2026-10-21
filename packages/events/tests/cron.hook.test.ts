import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// The shipped plugin: activation schedules `sweep-holds`, and its `cron` hook expires lapsed holds.
// The hook reads the real clock, so the seeded hold lapsed an hour ago.

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe("sweep-holds in the shipped plugin (EV-FR-06, R23)", () => {
	it("EV-FR-06 activation schedules the */5 sweeper", async () => {
		runtime = await createPluginRuntimeTestHost();
		await runtime.actions.plugin.activate();
		const tasks = await runtime.inspect.scheduledTasks();
		expect(tasks).toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "sweep-holds", schedule: "*/5 * * * *" })]),
		);
	});

	it("EV-FR-06 the cron hook releases an expired hold within budget", async () => {
		runtime = await createPluginRuntimeTestHost();
		const counted = { capacity: 50, reserved: 2, sold: 0 };
		await runtime.fixtures.plugin.storage("event_configs", "e1", { status: "on_sale", currency: "GBP", ...counted });
		await runtime.fixtures.plugin.storage("ticket_types", "tt", { eventId: "e1", name: "Std", ...counted });
		await runtime.fixtures.plugin.storage("bookings", "b1", {
			ref: "R1",
			eventId: "e1",
			status: "held",
			holdExpiresAt: ago(60),
			holdCeilingAt: ago(15),
			lines: [{ ticketTypeId: "tt", qty: 2, unitPriceMinor: 0 }],
			createdAt: ago(75),
		});
		const budget = withBudget(runtime);
		const r = await budget.invokeHook("cron", { name: "sweep-holds", scheduledAt: new Date().toISOString() });
		expectWithinBudget(r, { calls: 8 });
		expect(await runtime.inspect.storage.get("bookings", "b1")).toMatchObject({ status: "expired" });
		expect(await runtime.inspect.storage.get("event_configs", "e1")).toMatchObject({ reserved: 0 });
		expect(await runtime.inspect.storage.get("ticket_types", "tt")).toMatchObject({ reserved: 0 });
	});
});
