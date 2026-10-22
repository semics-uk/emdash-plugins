import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type AdminDeps, type AdminInteraction, handleAdmin } from "../admin/pages";

/**
 * The private `admin` route: every Block Kit page and action of the plugin (T028). The host
 * sends `page_load`, `block_action` and `form_submit` interactions here; `handleAdmin` answers
 * with `{ blocks }`. Admin only: it is not a public route.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown; request?: { url?: string } }, ctx: PluginContext) => Promise<unknown>;

export const ADMIN_ROUTES: Record<string, RouteDef> = {
	admin: {
		handler: (async (routeCtx, ctx) => {
			let origin = "http://localhost";
			try {
				origin = new URL(routeCtx.request?.url ?? "").origin;
			} catch {
				// No usable request URL: keep the fallback.
			}
			const deps: AdminDeps = { ctx, origin, now: Date.now() };
			return handleAdmin(deps, routeCtx.input as AdminInteraction);
		}) as Handler,
	},
};
