import { createPluginTestHost } from "@emdash-cms/plugin-test";
import { describe, expect, it } from "vitest";
import plugin from "../src/plugin";
import frozen from "../trust-contract.json";

// T106: the 1.0 trust contract is frozen in trust-contract.json (BUILD-PLAN §9). Adding a capability,
// an allowed host, a public route or an MCP tool after 1.0 is a major version that operators consent
// to again, so a change here must come with a major changeset and a new snapshot.

type Route = { public?: boolean; methods?: string[] };

async function liveContract() {
	const host = await createPluginTestHost();
	try {
		const routes = (plugin.routes ?? {}) as Record<string, Route>;
		const publicRoutes = Object.fromEntries(
			Object.entries(routes)
				.filter(([, route]) => route.public === true)
				.map(([name, route]) => [name, [...(route.methods ?? [])].sort()])
				.sort(([a], [b]) => String(a).localeCompare(String(b))),
		);
		return {
			slug: "semics-events",
			capabilities: [...host.manifest.capabilities].sort(),
			allowedHosts: [...host.manifest.allowedHosts].sort(),
			publicRoutes,
			mcpTools: Object.keys((plugin as { mcp?: { tools?: object } }).mcp?.tools ?? {}).sort(),
			hooks: Object.keys(plugin.hooks ?? {}).sort(),
		};
	} finally {
		await host.dispose();
	}
}

describe("Events trust contract frozen at 1.0 (T106, BUILD-PLAN §9, R4)", () => {
	it("matches trust-contract.json exactly", async () => {
		expect(await liveContract()).toEqual(frozen.contract);
	});

	it("reads it: four capabilities, only the Turnstile host, no MCP tool in Free", () => {
		expect(frozen.contract.capabilities).toEqual(["content:read", "email:send", "network:request", "schema:read"]);
		expect(frozen.contract.allowedHosts).toEqual(["challenges.cloudflare.com"]);
		expect(frozen.contract.mcpTools).toEqual([]);
		expect(frozen.version).toBe("1.0.0");
	});

	it("names every public route by its PRD path; Stripe and receipts answer in Free without doing anything", () => {
		const names = Object.keys(frozen.contract.publicRoutes);
		expect(names.every((n) => n.startsWith("public/") || n === "webhooks/stripe" || n === "signatures/receipt")).toBe(
			true,
		);
		expect(names).toContain("webhooks/stripe");
		expect(names).toContain("signatures/receipt");
	});
});
