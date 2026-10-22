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

	it.each(ALWAYS_HIT)("%s queues the ensure task once, and its cron tick schedules both crons", async (route, input) => {
		const { r, budget } = await setup();
		const first = await budget.invokeRoute(route, input);
		expectWithinBudget(first, TARGET);
		expect(first.calls.filter(isCheck)).toHaveLength(1);
		expect(await taskNames(r)).toEqual([ENSURE_SCHEDULES_TASK]);

		const tick = await budget.measure("ensure tick", () => r.scheduled.run());
		expectWithinBudget(tick, TARGET);
		expect(await taskNames(r)).toEqual(["outbox-drain", "sweep-holds"]);
		const tasks = await r.inspect.scheduledTasks();
		expect(tasks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "sweep-holds", schedule: "*/5 * * * *" }),
				expect.objectContaining({ name: "outbox-drain", schedule: "* * * * *" }),
			]),
		);
		expect(await r.inspect.kv.get(SCHEDULES_FLAG)).toBeTruthy();
	});

	it("once scheduled, every always-hit path makes only the one KV check and schedules nothing", async () => {
		const { r, budget } = await setup();
		await budget.invokeRoute("public/events", {});
		await r.scheduled.run();
		for (const [route, input] of ALWAYS_HIT) {
			const res = await budget.invokeRoute(route, input);
			expectWithinBudget(res, TARGET);
			expect(res.calls.filter(isCheck), route).toHaveLength(1);
			expect(res.calls.filter(isSchedule), route).toEqual([]);
		}
	});

	it("activation (registry installs) schedules both crons and sets the flag, so no ensure task follows", async () => {
		const { r, budget } = await setup();
		await r.actions.plugin.activate();
		expect(await r.inspect.kv.get(SCHEDULES_FLAG)).toBeTruthy();
		const res = await budget.invokeRoute("public/events", {});
		expect(res.calls.filter(isSchedule)).toEqual([]);
		expect(await taskNames(r)).toEqual(["outbox-drain", "sweep-holds"]);
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
