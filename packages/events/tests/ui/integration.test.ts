import { describe, expect, it } from "vitest";

import { eventsIntegration } from "../../src/integration/index";

interface Injected {
	pattern: string;
	entrypoint: string | URL;
	prerender?: boolean;
}

interface VitePlugin {
	name: string;
	resolveId(id: string): string | undefined;
	load(id: string): string | undefined;
}

async function setup(options?: { pluginId?: string }) {
	const routes: Injected[] = [];
	let plugins: VitePlugin[] = [];
	const hook = eventsIntegration(options).hooks["astro:config:setup"];
	await hook?.({
		injectRoute: (r: Injected) => routes.push(r),
		updateConfig: (c: { vite?: { plugins?: VitePlugin[] } }) => {
			plugins = c.vite?.plugins ?? [];
		},
	} as never);
	return { routes, plugins };
}

describe("eventsIntegration (EU-FR-05, EU-FR-06)", () => {
	it("EU-FR-05 injects the no-JS checkout endpoint and the booking page, both server-rendered", async () => {
		const { routes } = await setup();
		expect(routes.map((r) => r.pattern).sort()).toEqual(["/_events/checkout", "/booking"]);
		for (const r of routes) expect(r.prerender).toBe(false);
	});

	it("defaults the core's plugin id to the slug and takes a registry id as an option", async () => {
		const read = async (opts?: { pluginId?: string }) => {
			const { plugins } = await setup(opts);
			const plugin = plugins.find((p) => p.name === "semics-events-config");
			return plugin?.load(plugin.resolveId("virtual:semics-events/config") ?? "");
		};
		expect(await read()).toContain('"semics-events"');
		expect(await read({ pluginId: "r_abc123" })).toContain('"r_abc123"');
	});
});
