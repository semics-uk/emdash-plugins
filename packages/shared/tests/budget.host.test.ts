import { createPluginRuntimeTestHost, createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { afterEach, describe, expect, it } from "vitest";
import { expectWithinBudget, withBudget } from "../testing/budget";

// Runs against tests/fixtures/budget-plugin (vitest.config.ts, project "budget-host").
// T007 / Spike S1 (local proxy): the harness that enforces EV-NFR-01, EV-NFR-02 and ES-NFR-01
// (≤ 10 bridge calls and a CPU ceiling per invocation) until T110 measures Cloudflare.

let host: PluginTestHost | undefined;
let disposeRuntime: (() => Promise<void>) | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
	await disposeRuntime?.();
	disposeRuntime = undefined;
});

describe("T007 bridge-call counter (EV-NFR-01, ES-NFR-01)", () => {
	it("reports exactly N calls for a route that makes N storage gets", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		for (const n of [0, 1, 3, 7]) {
			const result = await budget.invokeRoute("gets", { n });
			expect(result.value).toEqual({ n });
			expect(result.calls).toHaveLength(n);
		}
		const three = await budget.invokeRoute("gets", { n: 3 });
		expect(three.calls).toEqual([
			{ kind: "storage", method: "get", collection: "items", key: "k0" },
			{ kind: "storage", method: "get", collection: "items", key: "k1" },
			{ kind: "storage", method: "get", collection: "items", key: "k2" },
		]);
	});

	it("counts a batch read as one call and every kind of bridge round trip, settings and log included", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		expect((await budget.invokeRoute("batch", { n: 25 })).calls).toEqual([
			{ kind: "storage", method: "getMany", collection: "items" },
		]);
		const mixed = await budget.invokeRoute("mixed");
		expect(mixed.calls.map((call) => `${call.kind}.${call.method}`)).toEqual([
			"settings.get",
			"kv.get",
			"storage.put",
			"log.info",
		]);
	});

	it("attributes calls to the right invocation when invocations run concurrently", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		const [two, five, parallel] = await Promise.all([
			budget.invokeRoute("gets", { n: 2 }),
			budget.invokeRoute("gets", { n: 5 }),
			budget.invokeRoute("parallel", { n: 4 }),
		]);
		expect(two.calls).toHaveLength(2);
		expect(five.calls).toHaveLength(5);
		expect(parallel.calls).toHaveLength(4);
	});

	it("counts hook invocations and failed invocations without changing what the caller sees", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		const cron = await budget.invokeHook("cron", { name: "sweep", data: undefined, scheduledAt: "2026-10-11T00:00:00Z" });
		expect(cron.calls.map((call) => `${call.kind}.${call.method}`)).toEqual(["kv.get", "kv.set"]);

		const failed = await budget.invokeRoute("fails");
		expect(failed.ok).toBe(false);
		expect(failed.calls).toHaveLength(1);
		expect(() => failed.value).toThrow("fixture failure");
		await expect(host.invokeRoute("fails")).rejects.toThrow("fixture failure");
	});

	it("measures invocations made through the runtime test host", async () => {
		const runtime = await createPluginRuntimeTestHost();
		disposeRuntime = () => runtime.dispose();
		const budget = withBudget(runtime);
		const result = await budget.invokeRoute("gets", { n: 4 });
		expect(result.value).toEqual({ n: 4 });
		expect(result.calls).toHaveLength(4);
		const run = await budget.measure("two routes", async () => {
			await runtime.transport.invokeRoute("gets", { n: 1 });
			await runtime.transport.invokeRoute("gets", { n: 2 });
		});
		expect(run.invocations.map((invocation) => invocation.calls.length)).toEqual([1, 2]);
	});
});

describe("T007 expectWithinBudget (EV-NFR-01, ES-NFR-01)", () => {
	it("fails with a readable list of the calls when a route makes 11 calls", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		expectWithinBudget(await budget.invokeRoute("gets", { n: 10 }), { calls: 10 });

		const eleven = await budget.invokeRoute("gets", { n: 11 });
		let message = "";
		try {
			expectWithinBudget(eleven, { calls: 10 });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('route "gets" made 11 bridge calls (limit 10)');
		expect(message).toMatch(/^\s+1\. storage\.get items k0$/m);
		expect(message).toMatch(/^\s+11\. storage\.get items k10$/m);
	});

	it("uses the platform budget (10 calls, 50 ms CPU) by default", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		expectWithinBudget(await budget.invokeRoute("mixed"));
		expect(() => expectWithinBudget({ ...(eleven()), label: 'route "x"' })).toThrow("(limit 10)");
	});
});

describe("T007 CPU timer (EV-NFR-02)", () => {
	it("reports a stable figure (±20%) across 5 runs of a fixed workload", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		await budget.invokeRoute("spin", { n: 1000 }); // warm the isolate
		const samples: number[] = [];
		for (let run = 0; run < 5; run++) samples.push((await budget.invokeRoute("spin", { n: 15_000_000 })).cpuMs);
		const sorted = [...samples].sort((a, b) => a - b);
		const median = sorted[2] ?? 0;
		expect(median).toBeGreaterThan(5);
		for (const sample of samples) {
			expect(Math.abs(sample - median) / median, `samples ${samples.join(", ")} ms`).toBeLessThanOrEqual(0.2);
		}
	});

	it("excludes time the sandbox spends waiting on the bridge and fails a route over the CPU ceiling", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		const io = await budget.invokeRoute("gets", { n: 5 });
		expect(io.cpuMs).toBeLessThan(io.wallMs);
		const heavy = await budget.invokeRoute("spin", { n: 15_000_000 });
		expect(() => expectWithinBudget(heavy, { cpuMs: 1 })).toThrow(/CPU .* ms \(limit 1 ms\)/);
	});
});

/** A synthetic result with 11 calls, for checking the default limits without a host. */
function eleven() {
	const calls = Array.from({ length: 11 }, (_, i) => ({ kind: "kv", method: "get", key: `k${i}` }));
	return {
		ok: true as const,
		value: undefined,
		calls,
		cpuMs: 0,
		rawCpuMs: 0,
		wallMs: 0,
		invocations: [{ calls, cpuMs: 0, rawCpuMs: 0 }],
	};
}
