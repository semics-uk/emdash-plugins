import type { SandboxedPlugin } from "emdash/plugin";

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
		// Temporary probe for Spike S2 (T004). Echoes a small, bounded input. Removed after the spike.
		"public/probe": {
			public: true,
			methods: ["POST"],
			request: { body: "json", maxBytes: 1024 },
			handler: async (routeCtx, ctx) => {
				const input = routeCtx.input as { ping?: unknown } | undefined;
				const ping = typeof input?.ping === "string" ? input.ping.slice(0, 64) : null;
				return { pluginId: ctx.plugin.id, method: routeCtx.request.method, echo: { ping } };
			},
		},
	},
};

export default plugin;
