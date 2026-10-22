import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { ENSURE_SCHEDULES_TASK, SCHEDULES_FLAG } from "@semics-tech/shared";
import { type BridgeCall, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// T116 (R37): EmDash 1.2 never runs `plugin:activate` for a config-declared sandboxed core (this
// runtime host behaves the same until asked to activate). The E-sign outbox drain must still be
// scheduled from paths a live site always hits: admin page loads, template creation (needed
// before any envelope), and the signer's and verifier's first public calls.

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
	["admin", { type: "page_load", page: "/envelopes" }],
	["templates/create", { name: "Waiver", body: "# Waiver\n" }],
	["public/session", { token: "not-a-real-token" }],
	["public/verify", { sha256: "0".repeat(64) }],
];

describe("self-scheduling without plugin:activate (R37)", () => {
	it("starts with no recurring tasks: the host never activated the core", async () => {
		const { r } = await setup();
		expect(await taskNames(r)).toEqual([]);
	});

	it.each(ALWAYS_HIT)("%s queues the ensure task, and its cron tick schedules outbox-drain", async (route, input) => {
		const { r, budget } = await setup();
		const first = await budget.invokeRoute(route, input);
		expectWithinBudget(first, TARGET);
		expect(first.calls.filter(isCheck)).toHaveLength(1);
		expect(await taskNames(r)).toEqual([ENSURE_SCHEDULES_TASK]);

		const tick = await budget.measure("ensure tick", () => r.scheduled.run());
		expectWithinBudget(tick, TARGET);
		expect(await r.inspect.scheduledTasks()).toEqual([
			expect.objectContaining({ name: "outbox-drain", schedule: "* * * * *" }),
		]);
		expect(await r.inspect.kv.get(SCHEDULES_FLAG)).toBeTruthy();
	});

	it("once scheduled, every always-hit path makes only the one KV check and schedules nothing", async () => {
		const { r, budget } = await setup();
		await budget.invokeRoute("admin", { type: "page_load", page: "/envelopes" });
		await r.scheduled.run();
		for (const [route, input] of ALWAYS_HIT) {
			const res = await budget.invokeRoute(route, input);
			expectWithinBudget(res, TARGET);
			expect(res.calls.filter(isCheck), route).toHaveLength(1);
			expect(res.calls.filter(isSchedule), route).toEqual([]);
		}
	});

	it("activation (registry installs) schedules the drain and sets the flag", async () => {
		const { r, budget } = await setup();
		await r.actions.plugin.activate();
		expect(await r.inspect.kv.get(SCHEDULES_FLAG)).toBeTruthy();
		const res = await budget.invokeRoute("public/verify", { sha256: "0".repeat(64) });
		expect(res.calls.filter(isSchedule)).toEqual([]);
		expect(await taskNames(r)).toEqual(["outbox-drain"]);
	});

	it("leaves the routes nearest the limit alone: from-intent, submit and admin actions make no check", async () => {
		const { budget } = await setup();
		const paths: Array<[string, unknown]> = [
			["public/envelopes/from-intent", {}],
			["public/submit", { token: "not-a-real-token" }],
			["envelopes/send", { id: "missing" }],
			["admin", { type: "block_action", action_id: "nothing", page: "/envelopes" }],
		];
		for (const [route, input] of paths) {
			const res = await budget.invokeRoute(route, input);
			expect(res.calls.filter(isCheck), route).toEqual([]);
		}
	});
});
