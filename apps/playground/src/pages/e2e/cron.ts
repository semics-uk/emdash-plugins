// e2e-only (T056): runs a plugin cron task now, so tests don't wait for the one-minute timer.
//   POST /e2e/cron?task=outbox-drain[&plugin=semics-events]
// Makes the task due, then runs one scheduled-maintenance batch, exactly what the Node timer (or
// a Cloudflare Cron Trigger) does. The executor claims due tasks atomically, so a timer tick at the
// same moment can't run the task twice.
import { runScheduledTasks } from "emdash/middleware";

export const prerender = false;

interface Db {
	updateTable(table: string): {
		set(values: Record<string, unknown>): {
			where(column: string, op: string, value: string): {
				where(column: string, op: string, value: string): { executeTakeFirst(): Promise<{ numUpdatedRows: bigint }> };
			};
		};
	};
}

export async function POST({ url, locals }: { url: URL; locals: { emdash?: { db?: Db } } }): Promise<Response> {
	const task = url.searchParams.get("task") ?? "";
	const plugin = url.searchParams.get("plugin") ?? "semics-events";
	const db = locals.emdash?.db;
	if (!task || !db) return new Response(JSON.stringify({ ok: false }), { status: 400 });
	const due = new Date(Date.now() - 1000).toISOString();
	const { numUpdatedRows } = await db
		.updateTable("_emdash_cron_tasks")
		.set({ next_run_at: due })
		.where("plugin_id", "=", plugin)
		.where("task_name", "=", task)
		.executeTakeFirst();
	await runScheduledTasks();
	return new Response(JSON.stringify({ ok: true, scheduled: Number(numUpdatedRows) }), {
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});
}
