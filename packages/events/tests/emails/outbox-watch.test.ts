import type { PluginContext } from "emdash/plugin";
import { describe, expect, it } from "vitest";
import { runOutboxWatch, WATCH_TASK } from "../../src/emails/outbox";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

/** Events stores due times as ISO text: the watch queries and reports them so. */
function ctxWith(rows: Array<{ id: string; data: Record<string, unknown> }>) {
	const queries: unknown[] = [];
	const lines: unknown[][] = [];
	const kv = new Map<string, unknown>();
	const ctx = {
		storage: {
			outbox: {
				async query(o: { where: { nextAttemptAt: { lte: string } } }) {
					queries.push(o);
					return { items: rows.filter((r) => String(r.data.nextAttemptAt) <= o.where.nextAttemptAt.lte) };
				},
			},
		},
		kv: { get: async (k: string) => kv.get(k) ?? null, set: async (k: string, v: unknown) => void kv.set(k, v) },
		log: { warn: async () => undefined, error: async (...a: unknown[]) => void lines.push(a) },
	} as unknown as PluginContext;
	return { ctx, queries, lines };
}

describe("T187 Events outbox-watch", () => {
	it("reports a confirmation pending 15 minutes past due once, by id and kind", async () => {
		const t = ctxWith([
			{
				id: "confirm-bk_1",
				data: {
					status: "pending",
					kind: "confirmation",
					to: "a@example.com",
					nextAttemptAt: "2026-11-26T11:40:00.000Z",
				},
			},
		]);
		expect(await runOutboxWatch({ name: WATCH_TASK } as never, t.ctx, NOW)).toBe(true);
		expect(t.queries[0]).toMatchObject({
			where: { status: "pending", nextAttemptAt: { lte: "2026-11-26T11:45:00.000Z" } },
		});
		expect(t.lines).toEqual([
			[
				"outbox.stuck",
				{
					code: "outbox.stuck",
					count: 1,
					ids: "confirm-bk_1",
					kinds: "confirmation",
					dueAt: "2026-11-26T11:40:00.000Z",
				},
			],
		]);
		await runOutboxWatch({ name: WATCH_TASK } as never, t.ctx, NOW + 300_000);
		expect(t.lines).toHaveLength(1);
	});

	it("is not another task's", async () => {
		expect(await runOutboxWatch({ name: "outbox-drain" } as never, ctxWith([]).ctx, NOW)).toBe(false);
	});
});
