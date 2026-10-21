import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type AdminDeps, type AdminInteraction, handleAdmin } from "../admin/pages";

/**
 * The private `admin` route: every Block Kit page, widget and action of the plugin (T052). The
 * host sends `page_load`, `block_action` and `form_submit` interactions here; `handleAdmin`
 * answers with `{ blocks }`. Admin only: it is not a public route.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;

export const ADMIN_ROUTES: Record<string, RouteDef> = {
	admin: {
		handler: (async (routeCtx: { input?: unknown; request?: { url?: string } }, ctx: PluginContext) => {
			let origin = "http://localhost";
			try {
				origin = new URL(routeCtx.request?.url ?? "").origin;
			} catch {
				// No usable request URL: keep the fallback.
			}
			const deps: AdminDeps = {
				origin,
				storage: ctx.storage as unknown as AdminDeps["storage"],
				settings: ctx.settings as unknown as AdminDeps["settings"],
				schema: ctx.schema as unknown as AdminDeps["schema"],
				now: Date.now(),
				pluginId: ctx.plugin.id,
				newId: () => crypto.randomUUID(),
			};
			return handleAdmin(deps, routeCtx.input as AdminInteraction);
		}) as Handler,
	},
};
