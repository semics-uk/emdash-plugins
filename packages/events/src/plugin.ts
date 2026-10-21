import type { SandboxedPlugin } from "emdash/plugin";

import { CONFIG_ROUTES } from "./routes/config";
import { PUBLIC_ROUTES } from "./routes/public";

/**
 * Sandboxed plugin entry. The explicit `SandboxedPlugin` annotation gives TypeScript per-hook /
 * per-route inference (`ctx` is `PluginContext` automatically; hook
 * `event` parameters are typed by hook name).
 */
const plugin: SandboxedPlugin = {
	routes: {
		hello: {
			handler: async (_routeCtx, ctx) => {
				ctx.log.info("hello route called", { pluginId: ctx.plugin.id });
				return { greeting: "hello", pluginId: ctx.plugin.id };
			},
		},
		...CONFIG_ROUTES,
		...PUBLIC_ROUTES,
	},
};

export default plugin;
