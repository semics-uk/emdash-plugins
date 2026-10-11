import { defineConfig } from "@playwright/test";

// Shared e2e harness (T009). `pnpm --filter playground e2e` builds the events package and the site
// (e2e/harness/build.mjs), then Playwright starts e2e/harness/serve.mjs, which deletes data.db* and
// uploads/, seeds seed/seed.json and serves the build on port 4401. Playwright stops the server
// (and the workerd it spawned) after the run. Uses the system Chrome; never downloads browsers.
const PORT = 4401;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	use: { baseURL, channel: "chrome", headless: true },
	webServer: {
		command: "node ./e2e/harness/serve.mjs",
		url: `${baseURL}/`,
		env: { PORT: String(PORT), HOST: "127.0.0.1" },
		reuseExistingServer: false,
		gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
		timeout: 120_000,
	},
});
