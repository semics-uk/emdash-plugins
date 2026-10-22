import { isPageLoad, withScheduleCheck } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type AdminDeps, type AdminInteraction, handleAdmin, type SigningLink } from "../admin/pages";

/**
 * The private `admin` route: every Block Kit page, widget and action of the plugin (T052). The
 * host sends `page_load`, `block_action` and `form_submit` interactions here; `handleAdmin`
 * answers with `{ blocks }`. Admin only: it is not a public route. Page loads run the one-KV-read
 * schedule check (T116, R37).
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;

/** What a Pro build adds to the admin pages, built from the invocation's context. */
export interface AdminSteps {
	/** The signing link shown when check-in refuses an attendee whose waiver is pending (EV-FR-12). */
	signingLink?: (ctx: PluginContext) => SigningLink;
}

/** The `admin` route with the given steps (none: the Free route). */
export function adminRoute(steps: AdminSteps = {}): RouteDef {
	const route: RouteDef = {
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
				content: ctx.content as unknown as AdminDeps["content"],
				now: Date.now(),
				pluginId: ctx.plugin.id,
				newId: () => crypto.randomUUID(),
				...(steps.signingLink ? { signingLink: steps.signingLink(ctx) } : {}),
			};
			return handleAdmin(deps, routeCtx.input as AdminInteraction);
		}) as Handler,
	};
	return withScheduleCheck(route, isPageLoad);
}

export const ADMIN_ROUTES: Record<string, RouteDef> = { admin: adminRoute() };
