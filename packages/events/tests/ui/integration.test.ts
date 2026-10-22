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

async function setup(options?: { pluginId?: string; esignPluginId?: string; reconcile?: string }) {
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
		expect(routes.map((r) => r.pattern).sort()).toEqual([
			"/_events/checkout",
			"/_events/promo",
			"/_events/sign",
			"/booking",
		]);
		for (const r of routes) expect(r.prerender).toBe(false);
	});

	it("EV-FR-14 injects the promo code endpoint from the package's own export (T078)", async () => {
		const { routes } = await setup();
		expect(routes.find((r) => r.pattern === "/_events/promo")?.entrypoint).toBe(
			"@semics-tech/emdash-events/astro/promo-endpoint",
		);
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

	it("EV-FR-12 takes the e-sign core's plugin id for receipt lookups and door signing (null without it)", async () => {
		const read = async (opts?: { esignPluginId?: string }) => {
			const { plugins } = await setup(opts);
			const plugin = plugins.find((p) => p.name === "semics-events-config");
			return plugin?.load(plugin.resolveId("virtual:semics-events/config") ?? "");
		};
		expect(await read()).toContain("export const esignPluginId = null;");
		expect(await read({ esignPluginId: "r_esign" })).toContain('export const esignPluginId = "r_esign";');
	});

	it("SX-FR-05 takes the suite's reconciliation module for the booking page (null without it)", async () => {
		const read = async (opts?: { reconcile?: string }) => {
			const { plugins } = await setup(opts);
			const plugin = plugins.find((p) => p.name === "semics-events-config");
			return plugin?.load(plugin.resolveId("virtual:semics-events/config") ?? "");
		};
		expect(await read()).toContain("export const reconcile = null;");
		expect(await read({ reconcile: "@semics-tech/emdash-events-suite/astro/lib/reconcile" })).toContain(
			'export { reconcileBooking as reconcile } from "@semics-tech/emdash-events-suite/astro/lib/reconcile";',
		);
	});
});
