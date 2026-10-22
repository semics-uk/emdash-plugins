/**
 * Self-scheduling of a core's recurring cron tasks (T116, R37).
 *
 * EmDash 1.2 runs `plugin:activate` only for native config plugins and for admin installs or
 * re-enables, never for a sandboxed core declared under `sandboxed: [...]` in `astro.config.mjs`,
 * so `ctx.cron.schedule` in `plugin:activate` alone leaves an npm/config install with no recurring
 * tasks. Cores therefore also call `ensureSchedules` from paths a live site always hits.
 *
 * Budget: the check is one KV read. When the flag is missing it queues a single one-shot task,
 * `ensure-schedules`, due now (one more call), instead of scheduling everything inline; the task's
 * own cron invocation (`runEnsureSchedulesJob`) schedules the recurring tasks and sets the flag.
 * So a guarded route pays +1 call, +2 the first time, whatever the number of recurring tasks.
 * `ctx.cron.schedule` is an upsert that resets `next_run_at`, which is why the flag matters: the
 * recurring tasks are written once, not pushed back on every request.
 */

/**
 * KV flag set once the recurring tasks are scheduled. Bump the version when a core's task list
 * changes, so sites scheduled under the old list schedule the new task too. v2: E-sign `nonce-sweep`
 * (T061). v3: Events `retention` (T087). v4: Events Pro `stripe-sweep` (T075). Each core has its own KV, so a bump only re-runs the ensure task once on the other core.
 */
export const SCHEDULES_FLAG = "cron:scheduled:v4";

/** One-shot task that schedules the recurring ones from inside a cron invocation. */
export const ENSURE_SCHEDULES_TASK = "ensure-schedules";

export interface RecurringTask {
	readonly name: string;
	readonly schedule: string;
}

/** The slice of a sandboxed `PluginContext` this module uses. */
export interface ScheduleCtx {
	kv: {
		get(key: string): Promise<unknown>;
		set(key: string, value: unknown): Promise<void>;
	};
	cron?: { schedule(name: string, opts: { schedule: string }): Promise<void> } | undefined;
}

/**
 * The cheap check for always-hit paths: one KV read, plus one cron write when the flag is missing.
 * Never throws, so a guarded route answers even when KV or the scheduler fails.
 */
export async function ensureSchedules(ctx: ScheduleCtx, now: number): Promise<void> {
	try {
		if (await ctx.kv.get(SCHEDULES_FLAG)) return;
		await ctx.cron?.schedule(ENSURE_SCHEDULES_TASK, { schedule: new Date(now).toISOString() });
	} catch {
		// Best effort: the next always-hit request tries again.
	}
}

/**
 * Schedules every recurring task, one call each (`plugin:activate`, when the host runs it). Leaves
 * the flag alone so activation costs what it always did; the first guarded call after it queues
 * the ensure task once, which re-writes the same rows and sets the flag.
 */
export async function scheduleTasks(ctx: ScheduleCtx, tasks: readonly RecurringTask[]): Promise<boolean> {
	const cron = ctx.cron;
	if (!cron) return false;
	for (const task of tasks) await cron.schedule(task.name, { schedule: task.schedule });
	return true;
}

/** Schedules every recurring task, then sets the flag (the ensure job). */
export async function scheduleRecurring(ctx: ScheduleCtx, tasks: readonly RecurringTask[], now: number): Promise<void> {
	if (await scheduleTasks(ctx, tasks)) await ctx.kv.set(SCHEDULES_FLAG, { at: new Date(now).toISOString() });
}

/** The `cron` hook's share for the ensure task; true when `event` was ours. */
export async function runEnsureSchedulesJob(
	event: { name: string },
	ctx: ScheduleCtx,
	tasks: readonly RecurringTask[],
	now: number,
): Promise<boolean> {
	if (event.name !== ENSURE_SCHEDULES_TASK) return false;
	await scheduleRecurring(ctx, tasks, now);
	return true;
}

/** Admin interactions that start every admin visit: page and widget loads, not actions. */
export function isPageLoad(input: unknown): boolean {
	return typeof input === "object" && input !== null && (input as { type?: unknown }).type === "page_load";
}

/**
 * Wraps a route definition so its handler runs `ensureSchedules` first (when `when(input)` holds).
 * Use only on routes with budget headroom: the check costs +1 call, +2 the first time.
 */
export function withScheduleCheck<D extends object>(
	def: D,
	when: (input: unknown) => boolean = () => true,
	now: () => number = Date.now,
): D {
	const inner = (def as { handler: (routeCtx: { input?: unknown }, ctx: ScheduleCtx) => unknown }).handler;
	const handler = async (routeCtx: { input?: unknown }, ctx: ScheduleCtx) => {
		if (when(routeCtx?.input)) await ensureSchedules(ctx, now());
		return inner(routeCtx, ctx);
	};
	return { ...def, handler } as D;
}
