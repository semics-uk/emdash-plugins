import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import { eventsSuite } from "@semics-tech/emdash-events-suite";
import { mailCapture } from "./src/e2e/mail-capture.mjs";

// Both products linked by the suite (T065): the Free cores, both UI kits, the pages of each product and
// the suite's waiver page, every part told the plugin id of each core.
const suite = eventsSuite();

export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		...suite.integrations,
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: suite.sandboxed,
			// mailCapture: the e2e email provider (T056); production builds have no dev console provider.
			plugins: [...suite.plugins, mailCapture()],
		}),
	],
	devToolbar: { enabled: false },
});
