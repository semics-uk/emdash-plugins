// T103: the "Pages and components" table lists exactly the pages the integrations inject.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { esignIntegration } from "@semics-tech/emdash-esign/integration";
import { eventsIntegration } from "@semics-tech/emdash-events/integration";
import { suiteIntegration } from "@semics-tech/emdash-events-suite";
import { repoRoot } from "../build.mjs";

function injected(integration) {
	const routes = [];
	integration.hooks["astro:config:setup"]({ injectRoute: (r) => routes.push(r.pattern), updateConfig: () => {} });
	return routes;
}

test("every injected page is documented, and every documented page is injected", () => {
	const routes = [
		...injected(eventsIntegration()),
		...injected(esignIntegration()),
		...injected(suiteIntegration({ eventsPluginId: "semics-events", esignPluginId: "semics-esign" })),
	].sort();
	const page = readFileSync(join(repoRoot, "apps/docs/pages/site-pages.md"), "utf8");
	const table = /## Pages the plugins add\n([\s\S]*?)\n## /.exec(page)?.[1] ?? "";
	const documented = [...table.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]).sort();
	assert.deepEqual(documented, routes);
});
