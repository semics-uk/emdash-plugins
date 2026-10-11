import { defineConfig } from "@playwright/test";

// Minimal config for Spike S2 (T004). T009 replaces this with the shared e2e harness.
// The site must be built first (`pnpm run e2e` builds it). Uses the system Chrome; never
// downloads browsers.
const PORT = 4401;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	use: { baseURL, channel: "chrome", headless: true },
	webServer: {
		command: "node ./dist/server/entry.mjs",
		url: `${baseURL}/`,
		env: { PORT: String(PORT), HOST: "127.0.0.1" },
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
