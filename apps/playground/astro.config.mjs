import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { eventsSuite } from "@semics-tech/emdash-events-suite";
import { mailCapture } from "./src/e2e/mail-capture.mjs";

// Two switches, both off for the local e2e suite (T111):
//   PLAYGROUND_TARGET=cloudflare  the Cloudflare build (Astro Cloudflare adapter, D1, R2, the Worker Loader
//                                 sandbox); wrangler.jsonc picks the environment from CLOUDFLARE_ENV.
//   EMDASH_PRO_DIR=<Pro checkout> Events Pro in place of the Free core, linked into node_modules by
//                                 staging/link-pro.mjs. Pro source is never committed here (R40).
const cloudflareTarget = process.env.PLAYGROUND_TARGET === "cloudflare";

// Both products linked by the suite (T065): the Free cores, both UI kits, the pages of each product and
// the suite's waiver page, every part told the plugin id of each core.
const suite = process.env.EMDASH_PRO_DIR
	? eventsSuite({ events: (await import("@semics-tech/emdash-events-pro")).default })
	: eventsSuite();

async function platform() {
	if (!cloudflareTarget) {
		return {
			adapter: node({ mode: "standalone" }),
			database: sqlite({ url: "file:./data.db" }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
		};
	}
	const { default: cloudflare } = await import("@astrojs/cloudflare");
	const { d1, r2, sandbox } = await import("@emdash-cms/cloudflare");
	const sandboxRunner = sandbox();
	// Without the Worker Loader binding the cores would silently not load: refuse to build instead.
	if (!sandboxRunner) throw new Error("wrangler.jsonc has no LOADER Worker Loader binding for this environment");
	return {
		// Originals, not resized: no Cloudflare Images binding to provision for a test site.
		adapter: cloudflare({ imageService: "passthrough" }),
		database: d1({ binding: "DB", session: "auto" }),
		storage: r2({ binding: "MEDIA" }),
		sandboxRunner,
	};
}

const { adapter, ...site } = await platform();

export default defineConfig({
	output: "server",
	adapter,
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		...suite.integrations,
		emdash({
			...site,
			sandboxed: suite.sandboxed,
			// mailCapture: the e2e email provider (T056); production builds have no dev console provider.
			plugins: [...suite.plugins, mailCapture()],
		}),
	],
	vite: {
		// The /e2e helper routes (mail, cron) answer 404 on a deployed (Cloudflare) build.
		define: { "import.meta.env.PLAYGROUND_E2E_HELPERS": JSON.stringify(!cloudflareTarget) },
	},
	devToolbar: { enabled: false },
});
