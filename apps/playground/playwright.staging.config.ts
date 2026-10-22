import { defineConfig } from "@playwright/test";

import { stagingTarget } from "./staging/target.mjs";

// Staging suite (T111): `staging/e2e/*` against a deployed staging site.
//   STAGING_URL=https://… pnpm --filter playground e2e:staging        (the nightly, staging.yml)
//   E2E_PORT=4411 pnpm --filter playground e2e:staging:local           (the same specs on a local build)
// Without STAGING_URL (and without STAGING_LOCAL=1) it refuses to run: there is nothing deployed to test.
// Locally it starts the e2e server like playwright.config.ts (fresh seed, fixtures, the e2e admin token);
// set EMDASH_PRO_DIR to the Pro checkout to run the Pro journeys (check-in R54, opt-out R57).
const target = stagingTarget(process.env);
const port = new URL(target.baseURL).port;

export default defineConfig({
	testDir: "./staging/e2e",
	fullyParallel: false,
	workers: 1,
	retries: target.local ? 0 : 1,
	reporter: "list",
	timeout: 60_000,
	use: { baseURL: target.baseURL, channel: "chrome", headless: true },
	webServer: target.local
		? {
				command: "node ./e2e/harness/serve.mjs",
				url: `${target.baseURL}/`,
				env: { PORT: port, HOST: "127.0.0.1" },
				reuseExistingServer: false,
				gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
				timeout: 120_000,
			}
		: undefined,
});
