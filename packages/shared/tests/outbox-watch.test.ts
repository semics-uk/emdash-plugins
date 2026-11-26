import { describe, expect, it } from "vitest";
import { OUTBOX_STUCK_KEY, OUTBOX_STUCK_MS, type OutboxRecord, watchOutbox } from "../src/outbox";

const T0 = Date.UTC(2026, 10, 26, 9);
const row = (due: number, kind = "voucher_receipt", status: OutboxRecord["status"] = "pending"): OutboxRecord => ({
	message: { to: "a@example.com", subject: "s", text: "t", kind } as OutboxRecord["message"],
	status,
	attempts: 0,
	nextAttemptAt: due,
	createdAt: due,
});

function setup(rows: Record<string, OutboxRecord>) {
	const calls: string[] = [];
	const kvData = new Map<string, unknown>();
	const lines: Array<[string, Record<string, unknown>]> = [];
	return {
		calls,
		kvData,
		lines,
		opts: (now: number) => ({
			now,
			storage: {
				async query(q: { status: string; nextAttemptAtLte?: number; limit: number }) {
					calls.push("query");
					const items = Object.entries(rows)
						.filter(([, r]) => r.status === q.status && r.nextAttemptAt <= (q.nextAttemptAtLte ?? Infinity))
						.sort((a, b) => a[1].nextAttemptAt - b[1].nextAttemptAt)
						.slice(0, q.limit)
						.map(([id, data]) => ({ id, data }));
					return { items };
				},
				put: async () => undefined,
				putMany: async () => undefined,
			},
			kv: {
				async get(k: string) {
					calls.push("kv.get");
					return kvData.get(k) ?? null;
				},
				async set(k: string, v: unknown) {
					calls.push("kv.set");
					kvData.set(k, v);
				},
			},
			log: {
				warn: async () => undefined,
				error: async (m: string, d: unknown) => {
					calls.push("log");
					lines.push([m, d as Record<string, unknown>]);
				},
			},
		}),
	};
}

describe("T187 watchOutbox: a row pending 15 minutes past due is reported once", () => {
	it("nothing stuck costs one query and says nothing", async () => {
		const s = setup({ fresh: row(T0 - OUTBOX_STUCK_MS + 1000), later: row(T0 + 86_400_000, "voucher_gift") });
		expect(await watchOutbox(s.opts(T0))).toBe(0);
		expect(s.calls).toEqual(["query"]);
		expect(s.lines).toEqual([]);
	});

	it("a stuck row is one error with its id and kind, never the address; the next tick is quiet", async () => {
		const s = setup({ "receipt-vo_1": row(T0 - OUTBOX_STUCK_MS - 1) });
		expect(await watchOutbox(s.opts(T0))).toBe(1);
		expect(s.lines).toEqual([
			[
				"outbox.stuck",
				{
					code: "outbox.stuck",
					count: 1,
					ids: "receipt-vo_1",
					kinds: "voucher_receipt",
					dueAt: String(T0 - OUTBOX_STUCK_MS - 1),
				},
			],
		]);
		expect(JSON.stringify(s.lines)).not.toContain("example.com");
		expect(s.calls).toEqual(["query", "kv.get", "log", "kv.set"]);
		expect(s.kvData.get(OUTBOX_STUCK_KEY)).toEqual(["receipt-vo_1"]);

		s.calls.length = 0;
		expect(await watchOutbox(s.opts(T0 + 300_000))).toBe(0);
		expect(s.calls).toEqual(["query", "kv.get"]);
		expect(s.lines).toHaveLength(1);
	});

	it("a newly stuck row is reported, the one already told about is not", async () => {
		const rows = { old: row(T0 - 3_600_000) };
		const s = setup(rows);
		await watchOutbox(s.opts(T0));
		Object.assign(rows, { new: row(T0 - OUTBOX_STUCK_MS - 60_000, "voucher_gift") });
		expect(await watchOutbox(s.opts(T0 + 60_000))).toBe(1);
		expect(s.lines[1]?.[1]).toMatchObject({ count: 1, ids: "new", kinds: "voucher_gift" });
		expect(s.kvData.get(OUTBOX_STUCK_KEY)).toEqual(["old", "new"]);
	});

	it("failed and sent rows are not its business (the drain reported a give-up already)", async () => {
		const s = setup({ f: row(T0 - 3_600_000, "x", "failed"), d: row(T0 - 3_600_000, "x", "sent") });
		expect(await watchOutbox(s.opts(T0))).toBe(0);
	});

	it("a broken log does not throw", async () => {
		const s = setup({ a: row(T0 - 3_600_000) });
		const o = s.opts(T0);
		await expect(
			watchOutbox({ ...o, log: { warn: () => undefined, error: () => Promise.reject(new Error("rpc")) } }),
		).resolves.toBe(1);
	});
});
