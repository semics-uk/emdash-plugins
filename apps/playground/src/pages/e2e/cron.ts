// e2e-only (T056): runs a plugin cron task now, so tests don't wait for the one-minute timer.
//   POST /e2e/cron?task=outbox-drain[&plugin=semics-events]
// Makes the task due, then runs one scheduled-maintenance batch, exactly what the Node timer (or
// a Cloudflare Cron Trigger) does. The executor claims due tasks atomically, so a timer tick at the
// same moment can't run the task twice.
//
// EmDash 1.2 never runs `plugin:activate` for a sandboxed core declared in `sandboxed: [...]`, so
// the cores schedule their own recurring tasks (T116, R37): the first public read or admin page
// load queues a one-shot `ensure-schedules` task that the next batch runs. When the task row is
// still missing, this runs that batch first instead of activating the core.
import { withEmDashRuntime } from "emdash/middleware";

export const prerender = false;

interface Runtime {
	db: {
		updateTable(table: string): {
			set(values: Record<string, unknown>): {
				where(column: string, op: string, value: string): {
					where(column: string, op: string, value: string): { executeTakeFirst(): Promise<{ numUpdatedRows: bigint }> };
				};
			};
		};
	};
	runScheduledTasksWithStats(): Promise<{ processed: number }>;
}

export async function POST({ url }: { url: URL }): Promise<Response> {
	const task = url.searchParams.get("task") ?? "";
	const plugin = url.searchParams.get("plugin") ?? "semics-events";
	if (!task) return new Response(JSON.stringify({ ok: false }), { status: 400 });
	const result = await withEmDashRuntime(async (runtime) => {
		const rt = runtime as unknown as Runtime;
		const makeDue = async () => {
			const { numUpdatedRows } = await rt.db
				.updateTable("_emdash_cron_tasks")
				.set({ next_run_at: new Date(Date.now() - 1000).toISOString() })
				.where("plugin_id", "=", plugin)
				.where("task_name", "=", task)
				.executeTakeFirst();
			return Number(numUpdatedRows);
		};
		let scheduled = await makeDue();
		if (scheduled === 0) {
			await rt.runScheduledTasksWithStats();
			scheduled = await makeDue();
		}
		const { processed } = await rt.runScheduledTasksWithStats();
		return { scheduled, processed };
	});
	return new Response(JSON.stringify({ ok: true, ...result }), {
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});
}
