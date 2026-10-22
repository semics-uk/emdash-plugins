import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
	NONCE_SWEEP_MORE_TASK,
	NONCE_SWEEP_PAGE,
	NONCE_SWEEP_PAGES,
	NONCE_SWEEP_TASK,
	sweepNonces,
} from "../src/cron/nonce-sweep";

// T061 (SX-NFR-03): consumed intent nonces (`nonces/<cid>.<nonce>`, ISO `expiresAt` = exp + 60 s) are
// kept only as long as a replay could still verify. The recurring `nonce-sweep` deletes the lapsed
// ones a page at a time inside the bridge budget, and hands a backlog to a one-shot continuation.

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

/** R22: designs target 8 bridge calls per invocation. */
const TARGET = { calls: 8, cpuMs: 50 };
const iso = (ms: number) => new Date(ms).toISOString();

async function seed(r: PluginRuntimeTestHost, expired: number, live: number) {
	const now = Date.now();
	for (let i = 0; i < expired; i++) {
		const id = `cl_test_aaaaaaaa.expired${String(i).padStart(16, "0")}`;
		await r.fixtures.plugin.storage("nonces", id, {
			nonce: id,
			cid: "cl_test_aaaaaaaa",
			expiresAt: iso(now - 60_000 - i),
		});
	}
	for (let i = 0; i < live; i++) {
		const id = `cl_test_aaaaaaaa.live${String(i).padStart(19, "0")}`;
		await r.fixtures.plugin.storage("nonces", id, {
			nonce: id,
			cid: "cl_test_aaaaaaaa",
			expiresAt: iso(now + 600_000),
		});
	}
}

const tick = (name: string) => ({ name, scheduledAt: new Date().toISOString() });

describe("SX-NFR-03 nonce sweep", () => {
	it("SX-NFR-03 deletes only lapsed nonces, within budget", async () => {
		runtime = await createPluginRuntimeTestHost();
		const budget = withBudget(runtime);
		await seed(runtime, 5, 2);
		const ran = await budget.invokeHook("cron", tick(NONCE_SWEEP_TASK));
		expectWithinBudget(ran, TARGET);
		const left = await runtime.inspect.storage.list("nonces");
		expect(left.map((n) => n.id).sort()).toEqual([
			"cl_test_aaaaaaaa.live0000000000000000000",
			"cl_test_aaaaaaaa.live0000000000000000001",
		]);
		// Nothing left over: no continuation.
		expect((await runtime.inspect.scheduledTasks()).map((t) => t.name)).not.toContain(NONCE_SWEEP_MORE_TASK);
		// An empty sweep is one query.
		const empty = await budget.invokeHook("cron", tick(NONCE_SWEEP_TASK));
		expectWithinBudget(empty, { calls: 1, cpuMs: 50 });
	});

	it("SX-NFR-03 a backlog larger than one tick is paged and continued by a one-shot task", async () => {
		runtime = await createPluginRuntimeTestHost();
		const budget = withBudget(runtime);
		const backlog = NONCE_SWEEP_PAGE * NONCE_SWEEP_PAGES + 20;
		await seed(runtime, backlog, 1);
		const first = await budget.invokeHook("cron", tick(NONCE_SWEEP_TASK));
		expectWithinBudget(first, TARGET);
		expect(await runtime.inspect.storage.list("nonces")).toHaveLength(21);
		expect((await runtime.inspect.scheduledTasks()).map((t) => t.name)).toContain(NONCE_SWEEP_MORE_TASK);

		const more = await budget.invokeHook("cron", tick(NONCE_SWEEP_MORE_TASK));
		expectWithinBudget(more, TARGET);
		expect((await runtime.inspect.storage.list("nonces")).map((n) => n.id)).toEqual([
			"cl_test_aaaaaaaa.live0000000000000000000",
		]);
	});
});

// The job's logic against a fake collection (Node, for coverage): oldest first, `lt` the clock.
describe("sweepNonces", () => {
	function fakeStore(expiries: string[]) {
		const docs = new Map(expiries.map((e, i) => [`n${i}`, { expiresAt: e }]));
		const calls: string[] = [];
		return {
			docs,
			calls,
			nonces: {
				async query(o: { where: { expiresAt: { lt: string } }; orderBy: { expiresAt: "asc" }; limit: number }) {
					calls.push("query");
					const due = [...docs]
						.filter(([, d]) => d.expiresAt < o.where.expiresAt.lt)
						.sort((a, b) => (a[1].expiresAt < b[1].expiresAt ? -1 : 1));
					return {
						items: due.slice(0, o.limit).map(([id, data]) => ({ id, data })),
						hasMore: due.length > o.limit,
					};
				},
				async deleteMany(ids: string[]) {
					calls.push("deleteMany");
					for (const id of ids) docs.delete(id);
					return ids.length;
				},
			},
		};
	}

	it("keeps a nonce whose expiresAt is exactly now (retention is at least exp + 60 s)", async () => {
		const now = Date.parse("2026-10-22T12:00:00.000Z");
		const store = fakeStore([iso(now - 1), iso(now), iso(now + 1)]);
		const report = await sweepNonces({ nonces: store.nonces, now });
		expect(report).toEqual({ deleted: 1, more: false });
		expect([...store.docs.values()].map((d) => d.expiresAt)).toEqual([iso(now), iso(now + 1)]);
	});

	it("stops after the page limit and reports more, scheduling the continuation when a scheduler exists", async () => {
		const now = Date.parse("2026-10-22T12:00:00.000Z");
		const store = fakeStore(Array.from({ length: 7 }, (_, i) => iso(now - 1000 - i)));
		const scheduled: Array<[string, string]> = [];
		const cron = { schedule: async (name: string, o: { schedule: string }) => void scheduled.push([name, o.schedule]) };
		const report = await sweepNonces({ nonces: store.nonces, now, cron, page: 2, pages: 3 });
		expect(report).toEqual({ deleted: 6, more: true });
		expect(store.calls).toEqual(["query", "deleteMany", "query", "deleteMany", "query", "deleteMany"]);
		expect(scheduled).toEqual([[NONCE_SWEEP_MORE_TASK, iso(now + 60_000)]]);
		// Without a scheduler the recurring tick picks the rest up.
		expect(await sweepNonces({ nonces: store.nonces, now, page: 2, pages: 3 })).toEqual({ deleted: 1, more: false });
	});
});
