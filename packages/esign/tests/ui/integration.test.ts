import { describe, expect, it } from "vitest";

import { esignIntegration } from "../../src/integration/index";

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
	await esignIntegration(options).hooks["astro:config:setup"]?.({
		injectRoute: (r: Injected) => routes.push(r),
		updateConfig: (c: { vite?: { plugins?: VitePlugin[] } }) => {
			plugins = c.vite?.plugins ?? [];
		},
	} as never);
	return { routes, plugins };
}

describe("esignIntegration (SU-FR-01, SU-FR-02)", () => {
	it("SU-FR-01 injects /sign/[token] and /verify, both server-rendered", async () => {
		const { routes } = await setup();
		expect(routes.map((r) => r.pattern).sort()).toEqual(["/sign/[token]", "/signed/[token]", "/verify"]);
		for (const r of routes) {
			expect(r.prerender).toBe(false);
			expect(String(r.entrypoint)).toMatch(/^@semics-tech\/emdash-esign\/astro\//);
		}
	});

	it("defaults the core's plugin id to the slug and takes a registry id as an option", async () => {
		const read = async (opts?: { pluginId?: string }) => {
			const { plugins } = await setup(opts);
			const plugin = plugins.find((p) => p.name === "semics-esign-config");
			return plugin?.load(plugin.resolveId("virtual:semics-esign/config") ?? "");
		};
		expect(await read()).toContain('"semics-esign"');
		expect(await read({ pluginId: "r_abc123" })).toContain('"r_abc123"');
	});
});
