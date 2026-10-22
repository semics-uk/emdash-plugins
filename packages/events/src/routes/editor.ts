import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { handlePanel, type PanelDeps, type PanelInteraction } from "../admin/panel";

/**
 * The private `editor/tickets` route behind the "Tickets & booking" editor panel (T043). The host
 * authorises the saved entry and attaches its identity as `routeCtx.ui.entry`; the entry id is the
 * event id. Never public: the manifest declares it as the panel's route.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (
	routeCtx: { input?: unknown; ui?: { entry?: { id?: unknown } } },
	ctx: PluginContext,
) => Promise<unknown>;

export const EDITOR_ROUTES: Record<string, RouteDef> = {
	"editor/tickets": {
		handler: (async (routeCtx, ctx) => {
			const id = routeCtx.ui?.entry?.id;
			const deps: PanelDeps = {
				storage: ctx.storage as unknown as PanelDeps["storage"],
				settings: ctx.settings as unknown as PanelDeps["settings"],
				content: (ctx.content ?? { get: async () => null }) as unknown as PanelDeps["content"],
				newId: () => crypto.randomUUID(),
			};
			return handlePanel(
				deps,
				(routeCtx.input ?? { type: "panel_load" }) as PanelInteraction,
				typeof id === "string" ? id : "",
			);
		}) as Handler,
	},
};
