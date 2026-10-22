import {
	isPageLoad,
	type RecurringTask,
	runEnsureSchedulesJob,
	scheduleTasks,
	withScheduleCheck,
} from "@semics-tech/shared";
import type { SandboxedPlugin } from "emdash/plugin";
import { runCompletionEmailJob } from "./cron/completion-email";
import { EXPIRE_SCHEDULE, EXPIRE_TASK, runExpireJob } from "./cron/expire";
import { runIntentFinishJob } from "./cron/intent-finish";
import { NONCE_SWEEP_SCHEDULE, NONCE_SWEEP_TASK, runNonceSweepJob } from "./cron/nonce-sweep";
import { runPdfJob } from "./cron/pdf";
import { RETENTION_SCHEDULE, RETENTION_TASK, runRetentionJob } from "./cron/retention";
import { OUTBOX_SCHEDULE, OUTBOX_TASK, runOutboxJob } from "./emails/outbox";
import { ADMIN_ROUTES } from "./routes/admin";
import { catalogHandler } from "./routes/catalog";
import { CEREMONY_HANDLERS } from "./routes/ceremony";
import { downloadHandler } from "./routes/download";
import { ENVELOPE_ROUTES } from "./routes/envelopes";
import { fromIntentHandler } from "./routes/from-intent";
import { publicRoutes } from "./routes/public";
import { lookupHandler } from "./routes/receipts";
import { TEMPLATE_ROUTES } from "./routes/templates";
import { verifyHandler } from "./routes/verify";

type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];

/**
 * The recurring cron tasks (T116, R37). EmDash 1.2 never runs `plugin:activate` for a core declared
 * under `sandboxed: [...]` in `astro.config.mjs`, so besides activation the routes every live site
 * hits (admin page loads, template creation, `verify`) run the one-KV-read
 * schedule check. `from-intent`, `submit`, `session` (7 calls) and admin actions do not.
 */
const RECURRING_TASKS: readonly RecurringTask[] = [
	{ name: OUTBOX_TASK, schedule: OUTBOX_SCHEDULE },
	// T061: joined the list after T116, so the shared schedule flag moved to v2.
	{ name: NONCE_SWEEP_TASK, schedule: NONCE_SWEEP_SCHEDULE },
	// T097: the shared flag moved to v5.
	{ name: RETENTION_TASK, schedule: RETENTION_SCHEDULE },
	// T092: expiry closes unsigned envelopes (Free); the shared flag moved to v6.
	{ name: EXPIRE_TASK, schedule: EXPIRE_SCHEDULE },
];

const PUBLIC = publicRoutes({
	"public/envelopes/from-intent": fromIntentHandler,
	"public/download": downloadHandler,
	"public/verify": verifyHandler,
	"public/receipts/lookup": lookupHandler,
	"public/templates/catalog": catalogHandler,
	...CEREMONY_HANDLERS,
});

/** Sandboxed plugin entry. Route handlers are filled in by the tasks that own each route. */
const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:activate": async (_event, ctx) => {
			await scheduleTasks(ctx, RECURRING_TASKS);
		},
		cron: async (event, ctx) => {
			if (await runEnsureSchedulesJob(event, ctx, RECURRING_TASKS, Date.now())) return;
			if (await runOutboxJob(event, ctx)) return;
			if (await runCompletionEmailJob(event, ctx)) return;
			if (await runIntentFinishJob(event, ctx)) return;
			if (await runNonceSweepJob(event, ctx)) return;
			if (await runRetentionJob(event, ctx)) return;
			if (await runExpireJob(event, ctx)) return;
			await runPdfJob(event, ctx);
		},
	},
	routes: {
		...PUBLIC,
		...ADMIN_ROUTES,
		...TEMPLATE_ROUTES,
		...ENVELOPE_ROUTES,
		admin: withScheduleCheck(ADMIN_ROUTES.admin as RouteDef, isPageLoad),
		"templates/create": withScheduleCheck(TEMPLATE_ROUTES["templates/create"] as RouteDef),
		"public/verify": withScheduleCheck(PUBLIC["public/verify"] as RouteDef),
	},
};

export default plugin;
