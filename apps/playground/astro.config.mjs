import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";
import semicsEvents from "@semics-tech/emdash-events";
import { eventsUi } from "@semics-tech/emdash-events/ui";

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
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: [semicsEvents],
			plugins: [eventsUi()],
		}),
	],
	devToolbar: { enabled: false },
});
