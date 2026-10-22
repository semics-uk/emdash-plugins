// The Cloudflare build of the playground (T111): the same package builds as the e2e harness, then
// `astro build` with the Cloudflare adapter for the wrangler environment in CLOUDFLARE_ENV (default
// `staging`). The output is dist/ plus dist/server/wrangler.json (the flattened staging config), which
// `wrangler deploy` reads. Set EMDASH_PRO_DIR to build with Events Pro.
//
//   pnpm --filter playground build:staging
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, [resolve(root, "e2e/harness/build.mjs")], {
	cwd: root,
	stdio: "inherit",
	env: {
		...process.env,
		PLAYGROUND_TARGET: "cloudflare",
		CLOUDFLARE_ENV: process.env.CLOUDFLARE_ENV ?? "staging",
		E2E_SKIP_BUILD: "", // always build
	},
});
process.exit(result.status ?? 1);
