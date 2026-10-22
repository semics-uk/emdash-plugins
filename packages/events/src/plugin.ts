import type { SandboxedPlugin } from "emdash/plugin";

import { runCron, scheduleSweeper } from "./cron/sweep";
import { runOutboxJob, scheduleOutbox } from "./emails/outbox";
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
import { PUBLIC_ROUTES } from "./routes/public";

/**
 * Sandboxed plugin entry. The explicit `SandboxedPlugin` annotation gives TypeScript per-hook /
 * per-route inference (`ctx` is `PluginContext` automatically; hook
 * `event` parameters are typed by hook name).
 */
const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:activate": async (_event, ctx) => {
			await scheduleSweeper(ctx);
			await scheduleOutbox(ctx);
		},
		"content:afterSave": contentAfterSave,
		"content:afterPublish": contentAfterPublish,
		"content:afterUnpublish": contentAfterUnpublish,
		"content:beforeDelete": contentBeforeDelete,
		"content:afterDelete": contentAfterDelete,
		"page:metadata": pageMetadata,
		cron: async (event, ctx) => {
			if (!(await runOutboxJob(event, ctx))) await runCron(event, ctx);
		},
	},
	routes: {
		hello: {
			handler: async (_routeCtx, ctx) => {
				ctx.log.info("hello route called", { pluginId: ctx.plugin.id });
				return { greeting: "hello", pluginId: ctx.plugin.id };
			},
		},
		...CONFIG_ROUTES,
		...ADMIN_ROUTES,
		...ATTENDEE_ROUTES,
		...PUBLIC_ROUTES,
	},
};

export default plugin;
