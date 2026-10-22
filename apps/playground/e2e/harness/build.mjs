// Builds what the e2e server needs: the events package first (the site imports its dist), then the site.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { linkPro } from "../../staging/link-pro.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// E2E_SKIP_BUILD=1 reuses the previous build (only for iterating on specs; CI and verify always build).
if (process.env.E2E_SKIP_BUILD === "1") process.exit(0);
// Re-use the pnpm that launched this script (the repo pins pnpm 10.23.0 through corepack).
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("run through pnpm: `pnpm --filter playground e2e`");

function run(args) {
	const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: root, stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["--filter", "@semics-tech/emdash-events", "build"]);
run(["--filter", "@semics-tech/emdash-esign", "build"]);
run(["--filter", "@semics-tech/emdash-events-suite", "build"]);
// The Pro variant (T111): EMDASH_PRO_DIR points at a Pro checkout whose Events Pro is built.
if (process.env.EMDASH_PRO_DIR) linkPro(root, resolve(process.env.EMDASH_PRO_DIR));
run(["exec", "astro", "build"]);
