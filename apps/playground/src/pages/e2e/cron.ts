// e2e-only (T056): runs a plugin cron task now, so tests don't wait for the one-minute timer.
//   POST /e2e/cron?task=outbox-drain[&plugin=semics-events]
// Makes the task due, then runs one scheduled-maintenance batch, exactly what the Node timer (or
// a Cloudflare Cron Trigger) does. The executor claims due tasks atomically, so a timer tick at the
// same moment can't run the task twice.
//
// EmDash 1.2 runs `plugin:install`/`plugin:activate` at boot only for native config plugins, so a
// sandboxed core declared in `sandboxed: [...]` never schedules its crons (no `outbox-drain` row)
// until an admin re-enables it. When the task is missing this runs the core's activate lifecycle
// first, as that re-enable would (follow-up recorded in tasks/T056).
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
	runPluginActivateLifecycle(pluginId: string): Promise<void>;
}

export async function POST({ url }: { url: URL }): Promise<Response> {
	const task = url.searchParams.get("task") ?? "";
	const plugin = url.searchParams.get("plugin") ?? "semics-events";
	if (!task) return new Response(JSON.stringify({ ok: false }), { status: 400 });
	const due = new Date(Date.now() - 1000).toISOString();
	const result = await withEmDashRuntime(async (runtime) => {
		const rt = runtime as unknown as Runtime;
		const makeDue = async () => {
			const { numUpdatedRows } = await rt.db
				.updateTable("_emdash_cron_tasks")
				.set({ next_run_at: due })
				.where("plugin_id", "=", plugin)
				.where("task_name", "=", task)
				.executeTakeFirst();
			return Number(numUpdatedRows);
		};
		let scheduled = await makeDue();
		let activated = false;
		if (scheduled === 0) {
			await rt.runPluginActivateLifecycle(plugin);
			activated = true;
			scheduled = await makeDue();
		}
		const { processed } = await rt.runScheduledTasksWithStats();
		return { scheduled, activated, processed };
	});
	return new Response(JSON.stringify({ ok: true, ...result }), {
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});
}
