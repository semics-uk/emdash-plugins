// Where the staging suite runs (T111), and the guard the nightly runs before `wrangler deploy`.
//
//   stagingTarget(env)   STAGING_URL (https) for a deployed site, or STAGING_LOCAL=1 for the local
//                        e2e server on E2E_PORT. Throws when neither is set: nothing is deployed yet.
//   node staging/target.mjs --assert-build [dist/server/wrangler.json]
//                        refuses a build that was not made for the staging env (CLOUDFLARE_ENV=staging),
//                        so the nightly can only ever deploy `semics-staging-*` resources.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ADMIN_TOKEN } from "../e2e/harness/esign-admin.mjs";

export const STAGING_PREFIX = "semics-staging-";

/** @param {Record<string, string | undefined>} env */
export function stagingTarget(env) {
	const local = env.STAGING_LOCAL === "1";
	const expectPro = env.STAGING_EXPECT_PRO === "1";
	if (local) {
		return {
			baseURL: `http://127.0.0.1:${env.E2E_PORT ?? "4401"}`,
			local: true,
			// The local server has the /e2e helper routes (mail, cron) and the throwaway e2e admin token.
			helpers: true,
			adminToken: env.STAGING_ADMIN_TOKEN || ADMIN_TOKEN,
			expectPro,
		};
	}
	if (!env.STAGING_URL) {
		throw new Error(
			"STAGING_URL is not set: deploy staging first (.github/workflows/staging.yml) or run the same specs locally with STAGING_LOCAL=1",
		);
	}
	const url = new URL(env.STAGING_URL);
	// http only on loopback: `wrangler dev` serving the Cloudflare build locally.
	const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
	if (url.protocol !== "https:" && !loopback) throw new Error(`STAGING_URL must be https, got ${url.protocol}`);
	return {
		baseURL: url.origin,
		local: false,
		helpers: false,
		adminToken: env.STAGING_ADMIN_TOKEN || undefined,
		expectPro,
	};
}

/** Throws unless a built wrangler config deploys only `semics-staging-*` resources on workers.dev. */
export function assertStagingBuild(config) {
	const bad = [];
	if (!config.name?.startsWith(STAGING_PREFIX)) bad.push(`worker name ${config.name}`);
	if (config.routes?.length || config.route) bad.push("a custom route (staging is workers.dev only)");
	for (const db of config.d1_databases ?? []) {
		if (!db.database_name?.startsWith(STAGING_PREFIX)) bad.push(`D1 ${db.database_name}`);
	}
	for (const b of config.r2_buckets ?? []) {
		if (!b.bucket_name?.startsWith(STAGING_PREFIX)) bad.push(`R2 ${b.bucket_name}`);
	}
	if (bad.length) throw new Error(`not a staging build (every resource must be ${STAGING_PREFIX}*): ${bad.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--assert-build") {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const file = resolve(root, process.argv[3] ?? "dist/server/wrangler.json");
	assertStagingBuild(JSON.parse(readFileSync(file, "utf8")));
	console.log(`[staging] ${file}: staging build`);
}
