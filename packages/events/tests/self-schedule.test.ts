import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { ENSURE_SCHEDULES_TASK, SCHEDULES_FLAG } from "@semics-tech/shared";
import { type BridgeCall, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// T116 (R37): EmDash 1.2 registers a config-declared sandboxed core without ever running
// `plugin:activate`, exactly like this runtime host (which only activates on request). The core
// must still end up with `sweep-holds` and `outbox-drain` scheduled, from the paths a live site
// always hits: the public event reads the UI makes and admin page loads.

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const TARGET = { calls: 8 };
const isCheck = (c: BridgeCall) => c.kind === "kv" && c.key === SCHEDULES_FLAG;
const isSchedule = (c: BridgeCall) => c.kind === "cron";

async function setup() {
	runtime = await createPluginRuntimeTestHost();
	return { r: runtime, budget: withBudget(runtime) };
}

/** One scheduler tick a second from now (the host clock is frozen at creation; the sandbox's is not). */
const tick = (r: PluginRuntimeTestHost) => {
	r.scheduled.setTime(new Date(Date.now() + 1000));
	return r.scheduled.run();
};

const taskNames = async (r: PluginRuntimeTestHost) =>
	(await r.inspect.scheduledTasks()).map((t) => String(t.name)).sort();

const ALWAYS_HIT: Array<[string, unknown]> = [
	["public/events", {}],
	["public/event", { eventId: "entry_missing" }],
	["admin", { type: "page_load", page: "/events" }],
];

describe("self-scheduling without plugin:activate (R37)", () => {
	it("starts with no recurring tasks: the host never activated the core", async () => {
		const { r } = await setup();
		expect(await taskNames(r)).toEqual([]);
	});

	it.each(ALWAYS_HIT)(
		"%s queues the ensure task once, and its cron tick schedules every recurring cron",
		async (route, input) => {
			const { r, budget } = await setup();
			const first = await budget.invokeRoute(route, input);
			expectWithinBudget(first, TARGET);
			expect(first.calls.filter(isCheck)).toHaveLength(1);
			expect(await taskNames(r)).toEqual([ENSURE_SCHEDULES_TASK]);

			const ran = await budget.measure("ensure tick", () => tick(r));
			expectWithinBudget(ran, TARGET);
			expect(await taskNames(r)).toEqual(["occurrences", "outbox-drain", "retention", "sweep-holds", "waitlist"]);
			const tasks = await r.inspect.scheduledTasks();
			expect(tasks).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "sweep-holds", schedule: "*/5 * * * *" }),
					expect.objectContaining({ name: "outbox-drain", schedule: "* * * * *" }),
					expect.objectContaining({ name: "retention", schedule: "17 * * * *" }),
					expect.objectContaining({ name: "waitlist", schedule: "* * * * *" }),
					expect.objectContaining({ name: "occurrences", schedule: "*/10 * * * *" }),
				]),
			);
			expect(await r.inspect.kv.get(SCHEDULES_FLAG)).toBeTruthy();
		},
	);

	it("once scheduled, every always-hit path makes only the one KV check and schedules nothing", async () => {
		const { r, budget } = await setup();
		await budget.invokeRoute("public/events", {});
		await tick(r);
		for (const [route, input] of ALWAYS_HIT) {
			const res = await budget.invokeRoute(route, input);
			expectWithinBudget(res, TARGET);
			expect(res.calls.filter(isCheck), route).toHaveLength(1);
			expect(res.calls.filter(isSchedule), route).toEqual([]);
		}
	});

	it("activation (registry installs) still schedules every cron; the ensure task then sets the flag once", async () => {
		const { r, budget } = await setup();
		const activated = await budget.measure("activate", () => r.actions.plugin.activate());
		expect(activated.calls.filter(isSchedule)).toHaveLength(5);
		expect(await taskNames(r)).toEqual(["occurrences", "outbox-drain", "retention", "sweep-holds", "waitlist"]);
		await budget.invokeRoute("public/events", {});
		await tick(r);
		expect(await taskNames(r)).toEqual(["occurrences", "outbox-drain", "retention", "sweep-holds", "waitlist"]);
		expect(await r.inspect.kv.get(SCHEDULES_FLAG)).toBeTruthy();
	});

	it("T084 T083 the flag version was bumped with the occurrences task (v10) and Events Pro reminders (v11)", () => {
		expect(SCHEDULES_FLAG).toBe("cron:scheduled:v11");
	});

	it("leaves the routes nearest the limit alone: checkout reserve/continue and admin actions make no check", async () => {
		const { budget } = await setup();
		const paths: Array<[string, unknown]> = [
			["public/checkout/reserve", {}],
			["public/checkout/continue", {}],
			["admin", { type: "block_action", action_id: "attendees.open", value: "ev1" }],
		];
		for (const [route, input] of paths) {
			const res = await budget.invokeRoute(route, input);
			expect(res.calls.filter(isCheck), route).toEqual([]);
		}
	});
});
