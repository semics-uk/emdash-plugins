import esignCore from "@semics-tech/emdash-esign";
import { esignUi } from "@semics-tech/emdash-esign/ui";
import eventsCore from "@semics-tech/emdash-events";
import { eventsUi } from "@semics-tech/emdash-events/ui";
import { describe, expect, it } from "vitest";

import { eventsSuite, suiteIntegration } from "../src/index";

// SX-FR-01: one call gives a site both cores, both UI kits and the Astro integrations, and every
// part is told the plugin id of each core it talks to (registry installs use `r_…` ids, S7/T005).

interface Injected {
	pattern: string;
	entrypoint: string;
}

/** Runs an integration's setup hook and returns the routes it injects and its virtual modules' source. */
function setUp(integration: { hooks: { "astro:config:setup": (args: never) => void } }) {
	const routes: Injected[] = [];
	const modules: Record<string, string> = {};
	integration.hooks["astro:config:setup"]({
		injectRoute: (route: Injected) => routes.push(route),
		updateConfig: ({ vite }: { vite: { plugins: Array<Record<string, (id: string) => unknown>> } }) => {
			for (const plugin of vite.plugins) {
				for (const id of [
					"virtual:semics-events/config",
					"virtual:semics-esign/config",
					"virtual:semics-events-suite/config",
				]) {
					const resolved = plugin.resolveId?.(id);
					if (typeof resolved === "string") modules[id] = String(plugin.load?.(resolved));
				}
			}
		},
	} as never);
	return { routes, modules };
}

/** The exported constants of a generated virtual module (`export const name = <json>;`). */
function exportsOf(source: string | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [, name, json] of (source ?? "").matchAll(/export const (\w+) = (.*?);$/gm)) {
		out[name as string] = JSON.parse(json as string);
	}
	return out;
}

function wiring(suite: ReturnType<typeof eventsSuite>) {
	const all = suite.integrations.map(setUp);
	return {
		routes: all.flatMap((a) => a.routes),
		events: exportsOf(all.map((a) => a.modules["virtual:semics-events/config"]).find(Boolean)),
		esign: exportsOf(all.map((a) => a.modules["virtual:semics-esign/config"]).find(Boolean)),
		suite: exportsOf(all.map((a) => a.modules["virtual:semics-events-suite/config"]).find(Boolean)),
	};
}

describe("eventsSuite() (SX-FR-01)", () => {
	it("SX-FR-01 returns both sandboxed cores and both UI descriptors to spread into emdash()", () => {
		const suite = eventsSuite();
		expect(suite.sandboxed).toEqual([eventsCore, esignCore]);
		expect(suite.plugins).toEqual([eventsUi(), esignUi()]);
		expect(suite.integrations.map((i) => i.name)).toEqual(["semics-events", "semics-esign", "semics-events-suite"]);
	});

	it("SX-FR-01 the plugin ids come from the core descriptors and reach both UI entries and the suite glue", () => {
		const suite = eventsSuite();
		expect(suite.pluginIds).toEqual({ events: eventsCore.id, esign: esignCore.id });
		const wired = wiring(suite);
		expect(wired.events).toEqual({ pluginId: eventsCore.id, esignPluginId: esignCore.id });
		expect(wired.esign).toEqual({ pluginId: esignCore.id });
		expect(wired.suite).toEqual({ eventsPluginId: eventsCore.id, esignPluginId: esignCore.id });
	});

	it("SX-FR-01 registry installs: the r_… ids are passed through and no core is loaded from npm", () => {
		const suite = eventsSuite({ events: { pluginId: "r_events123" }, esign: { pluginId: "r_esign456" } });
		expect(suite.sandboxed).toEqual([]);
		expect(suite.plugins).toEqual([eventsUi(), esignUi()]);
		const wired = wiring(suite);
		expect(wired.events).toEqual({ pluginId: "r_events123", esignPluginId: "r_esign456" });
		expect(wired.esign).toEqual({ pluginId: "r_esign456" });
		expect(wired.suite).toEqual({ eventsPluginId: "r_events123", esignPluginId: "r_esign456" });
	});

	it("SX-FR-01 a Pro build's descriptor replaces the Free core and keeps its id", () => {
		const pro = { ...eventsCore, entrypoint: "@semics-tech/some-pro-build/sandbox" };
		const suite = eventsSuite({ events: pro });
		expect(suite.sandboxed).toEqual([pro, esignCore]);
		expect(wiring(suite).suite).toMatchObject({ eventsPluginId: pro.id });
	});

	it("SX-FR-01 one core from npm, the other from the registry", () => {
		const suite = eventsSuite({ esign: { pluginId: "r_esign456" } });
		expect(suite.sandboxed).toEqual([eventsCore]);
		expect(wiring(suite).events).toEqual({ pluginId: eventsCore.id, esignPluginId: "r_esign456" });
	});

	it("SX-FR-01 refuses a plugin id that could not be a route segment", () => {
		for (const pluginId of ["", " ", "a/b", "../x", "x".repeat(200)]) {
			expect(() => eventsSuite({ events: { pluginId } }), JSON.stringify(pluginId)).toThrow(/plugin id/);
		}
	});

	it("SX-FR-02 injects the waiver booking page, plus the pages of both products", () => {
		const { routes } = wiring(eventsSuite());
		expect(routes.map((r) => r.pattern)).toEqual(
			expect.arrayContaining([
				"/_events/checkout",
				"/booking",
				"/_events/sign",
				"/sign/[token]",
				"/verify",
				"/_events/waiver",
			]),
		);
		expect(routes.find((r) => r.pattern === "/_events/waiver")?.entrypoint).toBe(
			"@semics-tech/emdash-events-suite/astro/WaiverPage.astro",
		);
	});

	it("SX-FR-05 the booking page reconciles through the suite's module; SX-FR-07 the catalogue page is injected", () => {
		const suite = eventsSuite();
		const { routes } = wiring(suite);
		expect(routes.find((r) => r.pattern === "/_events/templates")?.entrypoint).toBe(
			"@semics-tech/emdash-events-suite/astro/TemplatesPage.astro",
		);
		const source = setUp(suite.integrations[0] as never).modules["virtual:semics-events/config"];
		expect(source).toContain(
			'export { reconcileBooking as reconcile } from "@semics-tech/emdash-events-suite/astro/lib/reconcile";',
		);
	});

	it("SX-FR-02 suiteIntegration() alone needs both ids", () => {
		const { modules } = setUp(suiteIntegration({ eventsPluginId: "r_a", esignPluginId: "r_b" }));
		expect(exportsOf(modules["virtual:semics-events-suite/config"])).toEqual({
			eventsPluginId: "r_a",
			esignPluginId: "r_b",
		});
	});
});
