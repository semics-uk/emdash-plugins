import { defineConfig } from "@playwright/test";

// Shared e2e harness (T009). `pnpm --filter playground e2e` builds the events package and the site
// (e2e/harness/build.mjs), then Playwright starts e2e/harness/serve.mjs, which deletes data.db* and
// uploads/, seeds seed/seed.json and serves the build on port 4401. Playwright stops the server
// (and the workerd it spawned) after the run. Uses the system Chrome; never downloads browsers.
// E2E_PORT lets a second checkout run its own server (the default is 4401).
const PORT = Number(process.env.E2E_PORT ?? 4401);
const baseURL = `http://127.0.0.1:${PORT}`;
// The fake Stripe the Pro specs run (T135, e2e/harness/pro.ts stripePort()); the server reaches it through
// e2e/harness/stripe-preload.mjs. Free builds never call Stripe.
const STRIPE_PORT = Number(process.env.E2E_STRIPE_PORT ?? PORT + 1);

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	// One baseline per theme, shared by every OS (the card is small and uses only system fonts).
	snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{arg}{ext}",
	use: { baseURL, channel: "chrome", headless: true },
	webServer: {
		command: "node ./e2e/harness/serve.mjs",
		url: `${baseURL}/`,
		// Trust X-Forwarded-For so specs can give each visitor its own IP (the per-IP checkout limit, T056).
		env: {
			PORT: String(PORT),
			HOST: "127.0.0.1",
			EMDASH_TRUSTED_PROXY_HEADERS: "x-forwarded-for",
			E2E_STRIPE_URL: `http://127.0.0.1:${STRIPE_PORT}`,
		},
		reuseExistingServer: false,
		gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
		timeout: 120_000,
	},
});
