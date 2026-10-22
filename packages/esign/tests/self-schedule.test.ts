import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { ENSURE_SCHEDULES_TASK, SCHEDULES_FLAG } from "@semics-tech/shared";
import { type BridgeCall, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// T116 (R37): EmDash 1.2 never runs `plugin:activate` for a config-declared sandboxed core (this
// runtime host behaves the same until asked to activate). The E-sign outbox drain must still be
// scheduled from paths a live site always hits: admin page loads, template creation (needed
// before any envelope) and the public verify page. `public/session` (7 calls) is left alone.

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
	["admin", { type: "page_load", page: "/envelopes" }],
	["templates/create", { name: "Waiver", body: "# Waiver\n" }],
	["public/verify", { sha256: "0".repeat(64) }],
];

describe("self-scheduling without plugin:activate (R37)", () => {
	it("starts with no recurring tasks: the host never activated the core", async () => {
		const { r } = await setup();
		expect(await taskNames(r)).toEqual([]);
	});

	it.each(ALWAYS_HIT)(
		"%s queues the ensure task, and its cron tick schedules outbox-drain, nonce-sweep, retention and expire (no reminders: Pro)",
		async (route, input) => {
			const { r, budget } = await setup();
			const first = await budget.invokeRoute(route, input);
			expectWithinBudget(first, TARGET);
			expect(first.calls.filter(isCheck)).toHaveLength(1);
			expect(await taskNames(r)).toEqual([ENSURE_SCHEDULES_TASK]);

			const ran = await budget.measure("ensure tick", () => tick(r));
			expectWithinBudget(ran, TARGET);
			expect(await r.inspect.scheduledTasks()).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "outbox-drain", schedule: "* * * * *" }),
					expect.objectContaining({ name: "nonce-sweep", schedule: "0 * * * *" }),
				]),
			);
			expect(await taskNames(r)).toEqual(["expire", "nonce-sweep", "outbox-drain", "retention"]);
			expect(await r.inspect.kv.get(SCHEDULES_FLAG)).toBeTruthy();
		},
	);

	it("once scheduled, every always-hit path makes only the one KV check and schedules nothing", async () => {
		const { r, budget } = await setup();
		await budget.invokeRoute("admin", { type: "page_load", page: "/envelopes" });
		await tick(r);
		for (const [route, input] of ALWAYS_HIT) {
			const res = await budget.invokeRoute(route, input);
			expectWithinBudget(res, TARGET);
			expect(res.calls.filter(isCheck), route).toHaveLength(1);
			expect(res.calls.filter(isSchedule), route).toEqual([]);
		}
	});

	it("activation (registry installs) still schedules the drain in one call; the ensure task then sets the flag once", async () => {
		const { r, budget } = await setup();
		const activated = await budget.measure("activate", () => r.actions.plugin.activate());
		expect(activated.calls.filter(isSchedule)).toHaveLength(4);
		expect(await taskNames(r)).toEqual(["expire", "nonce-sweep", "outbox-drain", "retention"]);
		await budget.invokeRoute("public/verify", { sha256: "0".repeat(64) });
		await tick(r);
		expect(await taskNames(r)).toEqual(["expire", "nonce-sweep", "outbox-drain", "retention"]);
		expect(await r.inspect.kv.get(SCHEDULES_FLAG)).toBeTruthy();
	});

	it("T061 the flag version was bumped with nonce-sweep, so a site scheduled under v1 schedules the sweep too", async () => {
		expect(SCHEDULES_FLAG).toBe("cron:scheduled:v6");
		const { r, budget } = await setup();
		// A site whose drain was scheduled before nonce-sweep existed.
		await r.fixtures.plugin.kv("cron:scheduled:v1", { at: "2026-10-20T00:00:00.000Z" });
		const res = await budget.invokeRoute("admin", { type: "page_load", page: "/envelopes" });
		expectWithinBudget(res, TARGET);
		expect(await taskNames(r)).toContain(ENSURE_SCHEDULES_TASK);
		await tick(r);
		expect(await taskNames(r)).toEqual(["expire", "nonce-sweep", "outbox-drain", "retention"]);
	});

	it("leaves the routes nearest the limit alone: from-intent, submit, session and admin actions make no check", async () => {
		const { budget } = await setup();
		const paths: Array<[string, unknown]> = [
			["public/envelopes/from-intent", {}],
			["public/submit", { token: "not-a-real-token" }],
			["public/session", { token: "not-a-real-token" }],
			["envelopes/send", { id: "missing" }],
			["admin", { type: "block_action", action_id: "nothing", page: "/envelopes" }],
		];
		for (const [route, input] of paths) {
			const res = await budget.invokeRoute(route, input);
			expect(res.calls.filter(isCheck), route).toEqual([]);
		}
	});
});
