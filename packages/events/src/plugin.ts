import { type RecurringTask, runEnsureSchedulesJob, scheduleTasks, withScheduleCheck } from "@semics-tech/shared";
import type { SandboxedPlugin } from "emdash/plugin";

import { OCCURRENCES_SCHEDULE, OCCURRENCES_TASK, runOccurrencesJob } from "./cron/occurrences";
import { RETENTION_SCHEDULE, RETENTION_TASK, runRetentionJob } from "./cron/retention";
import { runCron, SWEEP_SCHEDULE, SWEEP_TASK } from "./cron/sweep";
import { runWaitlistJob, WAITLIST_SCHEDULE, WAITLIST_TASK } from "./cron/waitlist";
import { OUTBOX_SCHEDULE, OUTBOX_TASK, runOutboxJob } from "./emails/outbox";
import {
	contentAfterDelete,
	contentAfterPublish,
	contentAfterSave,
	contentAfterUnpublish,
	contentBeforeDelete,
} from "./hooks/content";
import { pageMetadata } from "./hooks/metadata";
import { ADMIN_ROUTES } from "./routes/admin";
import { ATTENDEE_ROUTES } from "./routes/attendees";
import { CONFIG_ROUTES } from "./routes/config";
import { EDITOR_ROUTES } from "./routes/editor";
import { PUBLIC_ROUTES } from "./routes/public";

/**
 * The recurring cron tasks (T116, R37). EmDash 1.2 never runs `plugin:activate` for a core declared
 * under `sandboxed: [...]` in `astro.config.mjs`, so besides activation the routes every live site
 * hits (the UI's public event reads and admin page loads) run the one-KV-read schedule check. The
 * routes nearest the bridge limit (checkout reserve/continue, admin actions) are left alone.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];

const RECURRING_TASKS: readonly RecurringTask[] = [
	{ name: SWEEP_TASK, schedule: SWEEP_SCHEDULE },
	{ name: OUTBOX_TASK, schedule: OUTBOX_SCHEDULE },
	{ name: RETENTION_TASK, schedule: RETENTION_SCHEDULE },
	{ name: WAITLIST_TASK, schedule: WAITLIST_SCHEDULE },
	{ name: OCCURRENCES_TASK, schedule: OCCURRENCES_SCHEDULE },
];

/**
 * Sandboxed plugin entry. The explicit `SandboxedPlugin` annotation gives TypeScript per-hook /
 * per-route inference (`ctx` is `PluginContext` automatically; hook
 * `event` parameters are typed by hook name).
 */
const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:activate": async (_event, ctx) => {
			await scheduleTasks(ctx, RECURRING_TASKS);
		},
		"content:afterSave": contentAfterSave,
		"content:afterPublish": contentAfterPublish,
		"content:afterUnpublish": contentAfterUnpublish,
		"content:beforeDelete": contentBeforeDelete,
		"content:afterDelete": contentAfterDelete,
		"page:metadata": pageMetadata,
		cron: async (event, ctx) => {
			if (await runEnsureSchedulesJob(event, ctx, RECURRING_TASKS, Date.now())) return;
			if (await runRetentionJob(event, ctx)) return;
			if (await runWaitlistJob(event, ctx)) return;
			if (await runOccurrencesJob(event, ctx)) return;
			if (!(await runOutboxJob(event, ctx))) await runCron(event, ctx);
		},
	},
	routes: {
		...CONFIG_ROUTES,
		...ADMIN_ROUTES,
		...ATTENDEE_ROUTES,
		...EDITOR_ROUTES,
		...PUBLIC_ROUTES,
		"public/events": withScheduleCheck(PUBLIC_ROUTES["public/events"] as RouteDef),
		"public/event": withScheduleCheck(PUBLIC_ROUTES["public/event"] as RouteDef),
	},
};

export default plugin;
