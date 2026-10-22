// T111: the Cloudflare staging playground and its nightly workflow. Everything here runs offline:
// the workflow and wrangler config are checked as text, the staging helpers as plain functions.
// Nothing is deployed; the live run is `.github/workflows/staging.yml` (owner enables it).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadVerdict } from "../apps/playground/load/checkout.mjs";
import { compareCpu, cpuQuery, parseCpu } from "../apps/playground/staging/cpu.mjs";
import { parseJsonc } from "../apps/playground/staging/jsonc.mjs";
import { assertLighthouse, lighthouseScore } from "../apps/playground/staging/lighthouse.mjs";
import { linkPro } from "../apps/playground/staging/link-pro.mjs";
import { dumpSql } from "../apps/playground/staging/seed-sql.mjs";
import { assertStagingBuild, stagingTarget } from "../apps/playground/staging/target.mjs";
import { checkVisitorIp, ipHash } from "../apps/playground/staging/visitor-ip.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = (name) => readFileSync(join(root, ".github", "workflows", name), "utf8");
const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const tmp = () => {
	const dir = mkdtempSync(join(tmpdir(), "t111-"));
	scratch.push(dir);
	return dir;
};

// Secret values never appear in the repo: these are the shapes of the real ones.
const SECRET_SHAPES = [
	/ec_pat_[A-Za-z0-9]{8,}/, // EmDash API token
	/(?<![\w-])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{40}(?![\w-])/, // Cloudflare API token (40 chars, mixed case; not a commit SHA)
	/\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
	/github_pat_[A-Za-z0-9_]{20,}/,
];

// --- the nightly workflow -------------------------------------------------------------------------

test("staging.yml runs nightly and on demand, only in the public repo once the owner enables it", () => {
	const text = workflow("staging.yml");
	assert.match(text, /^on:\n {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"/m, "a daily schedule");
	assert.match(text, /^ {2}workflow_dispatch:/m);
	assert.match(text, /github\.repository == 'semics-uk\/emdash-plugins'/);
	assert.match(text, /vars\.STAGING_ENABLED == 'true'/, "off until the owner sets STAGING_ENABLED");
	assert.match(text, /environment: staging/);
	assert.match(text, /^concurrency:\n {2}group: staging\n {2}cancel-in-progress: false/m);
	assert.match(text, /^permissions:\n {2}contents: read/m);
});

test("staging.yml references exactly the documented secrets, by name only", () => {
	const text = workflow("staging.yml");
	const names = new Set([...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]));
	assert.deepEqual([...names].sort(), [
		"CLOUDFLARE_ACCOUNT_ID",
		"CLOUDFLARE_API_TOKEN",
		"PRO_REPO_TOKEN",
		"STAGING_ADMIN_TOKEN",
	]);
	for (const shape of SECRET_SHAPES) assert.ok(!shape.test(text), `literal secret-like value ${shape}`);
});

test("staging.yml builds for the staging environment and deploys only a checked staging build", () => {
	const text = workflow("staging.yml");
	assert.match(text, /CLOUDFLARE_ENV: staging/);
	assert.match(text, /PLAYGROUND_TARGET: cloudflare/);
	assert.ok(!/production/i.test(text), "no production target anywhere");
	const deploys = [...text.matchAll(/wrangler deploy[^\n]*/g)].map((m) => m[0]);
	assert.ok(deploys.length >= 1, "a wrangler deploy step");
	for (const d of deploys) assert.ok(!/--env(?!\s+staging)/.test(d), `deploy names another env: ${d}`);
	// The build-output check runs before the deploy in the same job.
	const check = text.indexOf("staging/target.mjs --assert-build");
	assert.ok(check > 0 && check < text.indexOf("wrangler deploy"), "assert the staging build before deploying");
	// The D1 seed only ever touches the staging database.
	for (const m of text.matchAll(/wrangler d1 execute[^\n]*/g)) assert.match(m[0], /--remote/);
	assert.match(text, /e2e:staging/);
	assert.match(text, /load\/checkout\.mjs[^\n]*--shared-ip/);
	assert.match(text, /staging\/cpu\.mjs/);
	assert.match(text, /staging\/lighthouse\.mjs/);
	assert.match(text, /staging\/visitor-ip\.mjs/);
	assert.match(text, /STAGING_EXPECT_PRO: "1"/);
});

test("staging.yml checks Pro out read-only and never persists credentials", () => {
	const text = workflow("staging.yml");
	assert.match(text, /repository: semics-uk\/emdash-plugins-pro/);
	assert.match(text, /token: \$\{\{ secrets\.PRO_REPO_TOKEN \}\}/);
	const checkouts = text.match(/actions\/checkout@/g) ?? [];
	const persisted = text.match(/persist-credentials: false/g) ?? [];
	assert.equal(persisted.length, checkouts.length, "every checkout sets persist-credentials: false");
});

test("ci.yml installs qpdf so the T016 qpdf --check test runs, and snapshots.yml regenerates the T054 baselines on Linux", () => {
	assert.match(workflow("ci.yml"), /apt-get install[^\n]*\bqpdf\b/);
	const snaps = workflow("snapshots.yml");
	assert.match(snaps, /workflow_dispatch:/);
	assert.ok(!/schedule:/.test(snaps), "manual only");
	assert.match(snaps, /t054-events-list\.spec\.ts --update-snapshots/);
	assert.match(snaps, /upload-artifact@/);
});

// --- wrangler.jsonc --------------------------------------------------------------------------------

const wrangler = () => parseJsonc(readFileSync(join(root, "apps/playground/wrangler.jsonc"), "utf8"));

test("parseJsonc reads comments and trailing commas but keeps // inside strings", () => {
	assert.deepEqual(parseJsonc('{\n // c\n "a": "http://x", /* b */ "b": [1, 2,],\n}'), { a: "http://x", b: [1, 2] });
});

test("wrangler.jsonc: the staging env names every Cloudflare resource semics-staging-*", () => {
	const staging = wrangler().env?.staging;
	assert.ok(staging, "env.staging");
	assert.equal(staging.name, "semics-staging-playground");
	for (const db of staging.d1_databases ?? []) assert.match(db.database_name, /^semics-staging-/);
	for (const b of staging.r2_buckets ?? []) assert.match(b.bucket_name, /^semics-staging-/);
	for (const kv of staging.kv_namespaces ?? []) assert.match(kv.binding, /./);
	assert.deepEqual(
		(staging.d1_databases ?? []).map((d) => d.binding),
		["DB"],
	);
	assert.deepEqual(
		(staging.r2_buckets ?? []).map((b) => b.binding),
		["MEDIA"],
	);
	// Worker Loader: what the sandboxed cores run in on Cloudflare (S2 on Worker Loader).
	assert.deepEqual(staging.worker_loaders, [{ binding: "LOADER" }]);
	assert.deepEqual(staging.triggers?.crons, ["* * * * *"]);
	assert.equal(staging.workers_dev, true);
	assert.equal(staging.observability?.enabled, true, "CPU time per invocation for R27");
	// Provisioned on first deploy (wrangler 4): no ids or secrets committed.
	assert.ok(!JSON.stringify(staging).includes("database_id"));
	for (const key of Object.keys(staging.vars ?? {})) assert.ok(!/TOKEN|SECRET|KEY/.test(key), `secret in vars: ${key}`);
});

test("wrangler.jsonc: the top level is local only (no workers.dev URL, no deploy target)", () => {
	const config = wrangler();
	assert.ok(!config.name.startsWith("semics-staging-"));
	assert.equal(config.workers_dev, false);
	assert.ok(!config.routes && !config.route, "no routes at the top level");
	assert.deepEqual(config.worker_loaders, [{ binding: "LOADER" }]);
	assert.equal(config.main, "./src/worker.ts");
	assert.ok(config.compatibility_flags.includes("nodejs_compat"));
	const text = readFileSync(join(root, "apps/playground/wrangler.jsonc"), "utf8");
	for (const shape of SECRET_SHAPES) assert.ok(!shape.test(text), `literal secret-like value ${shape}`);
});

// --- staging target and build guard ---------------------------------------------------------------

test("stagingTarget: the staging suite refuses to run without STAGING_URL", () => {
	assert.throws(() => stagingTarget({}), /STAGING_URL is not set/);
	assert.throws(() => stagingTarget({ STAGING_URL: "http://example.com" }), /https/);
	const remote = stagingTarget({ STAGING_URL: "https://semics-staging-playground.example.workers.dev/" });
	assert.equal(remote.baseURL, "https://semics-staging-playground.example.workers.dev");
	assert.equal(remote.local, false);
	assert.equal(remote.helpers, false, "no /e2e helper routes on a deployed staging site");
	assert.equal(remote.adminToken, undefined);
	assert.equal(remote.expectPro, false);
	const pro = stagingTarget({ STAGING_URL: "https://s.example", STAGING_EXPECT_PRO: "1", STAGING_ADMIN_TOKEN: "x" });
	assert.equal(pro.expectPro, true);
	assert.equal(pro.adminToken, "x");
});

test("stagingTarget: STAGING_LOCAL=1 targets the local server on E2E_PORT with the e2e helpers", () => {
	const local = stagingTarget({ STAGING_LOCAL: "1", E2E_PORT: "4411" });
	assert.equal(local.baseURL, "http://127.0.0.1:4411");
	assert.equal(local.local, true);
	assert.equal(local.helpers, true);
	assert.match(local.adminToken, /^ec_pat_/, "the throwaway e2e token of the local database");
	assert.equal(stagingTarget({ STAGING_LOCAL: "1" }).baseURL, "http://127.0.0.1:4401");
});

test("assertStagingBuild accepts only a build made for the staging env", () => {
	assert.doesNotThrow(() => assertStagingBuild({ name: "semics-staging-playground", workers_dev: true }));
	assert.throws(() => assertStagingBuild({ name: "semics-playground-local" }), /semics-staging-/);
	assert.throws(
		() => assertStagingBuild({ name: "semics-staging-playground", routes: [{ pattern: "x.com/*" }] }),
		/route/,
	);
	assert.throws(
		() =>
			assertStagingBuild({
				name: "semics-staging-playground",
				d1_databases: [{ binding: "DB", database_name: "prod" }],
			}),
		/prod/,
	);
});

// --- D1 seed ---------------------------------------------------------------------------------------

test("dumpSql: a seeded SQLite database as statements D1 accepts, internal tables skipped", () => {
	const dir = tmp();
	const file = join(dir, "data.db");
	const db = new DatabaseSync(file);
	db.exec(`CREATE TABLE "things" (id TEXT PRIMARY KEY, data TEXT, n INTEGER, b BLOB);
		CREATE INDEX idx_things_n ON things (n);
		CREATE TABLE _cf_KV (k TEXT);
		INSERT INTO things VALUES ('a', 'it''s', 1, x'00ff'), ('b', NULL, 2, NULL);`);
	db.close();
	const sql = dumpSql(file);
	assert.match(sql, /DROP TABLE IF EXISTS "things";/);
	assert.match(sql, /CREATE TABLE "things"/);
	assert.match(sql, /CREATE INDEX idx_things_n/);
	assert.match(sql, /INSERT INTO "things" \("id", "data", "n", "b"\) VALUES \('a', 'it''s', 1, X'00ff'\);/);
	assert.match(sql, /VALUES \('b', NULL, 2, NULL\);/);
	assert.ok(!/_cf_KV|sqlite_/.test(sql));
	assert.ok(!/BEGIN|COMMIT/.test(sql), "D1 rejects explicit transactions");
	assert.ok(sql.indexOf("CREATE INDEX") > sql.indexOf("INSERT INTO"), "indexes after the rows");
});

test("dumpSql: replaces the throwaway e2e admin token with the staging token's hash, or drops it", () => {
	const dir = tmp();
	const file = join(dir, "data.db");
	const db = new DatabaseSync(file);
	db.exec(`CREATE TABLE _emdash_api_tokens (id TEXT, name TEXT, token_hash TEXT, prefix TEXT, user_id TEXT, scopes TEXT);
		INSERT INTO _emdash_api_tokens VALUES ('e2e-admin-token', 'e2e', 'OLDHASH', 'ec_pat_E2eA', 'e2e-admin', '["admin"]');`);
	db.close();
	const none = dumpSql(file);
	assert.ok(!none.includes("OLDHASH"), "never ship the public test token to a deployed site");
	assert.ok(!/INSERT INTO "_emdash_api_tokens"/.test(none));
	const token = "ec_pat_staging-secret-value-for-test";
	const withToken = dumpSql(file, { adminToken: token });
	assert.ok(!withToken.includes(token), "only the hash is written");
	assert.ok(withToken.includes(createHash("sha256").update(token).digest("base64url")));
	assert.ok(withToken.includes(`'${token.slice(0, 11)}'`));
});

// --- Pro variant -----------------------------------------------------------------------------------

test("linkPro links a built Events Pro into the playground's node_modules (never into git)", () => {
	const dir = tmp();
	const pro = join(dir, "pro");
	const site = join(dir, "site");
	mkdirSync(join(pro, "packages/events-pro/dist"), { recursive: true });
	mkdirSync(site);
	assert.throws(() => linkPro(site, pro), /not built/);
	writeFileSync(join(pro, "packages/events-pro/dist/index.mjs"), "export default {}");
	writeFileSync(join(pro, "packages/events-pro/dist/plugin.mjs"), "export default {}");
	const linked = linkPro(site, pro);
	const target = join(site, "node_modules/@semics-tech/emdash-events-pro");
	assert.equal(linked.events, target);
	assert.ok(lstatSync(target).isSymbolicLink());
	assert.ok(existsSync(join(target, "dist/plugin.mjs")));
	linkPro(site, pro); // idempotent
	assert.throws(() => linkPro(site, join(dir, "missing")), /EMDASH_PRO_DIR/);
});

// --- nightly measurements --------------------------------------------------------------------------

test("lighthouse: accessibility score from a report, gated at 95", () => {
	const report = { categories: { accessibility: { score: 0.97 } }, finalDisplayedUrl: "https://s/x" };
	assert.equal(lighthouseScore(report), 97);
	assert.doesNotThrow(() => assertLighthouse([report], 95));
	assert.throws(() => assertLighthouse([{ ...report, categories: { accessibility: { score: 0.94 } } }], 95), /94 < 95/);
	assert.throws(() => lighthouseScore({ categories: {} }), /accessibility/);
});

test("cpu: the Workers analytics query and the R27 comparison with the T007 figure", () => {
	const q = cpuQuery({ accountId: "acc", scriptName: "semics-staging-playground", since: "a", until: "b" });
	assert.match(q.query, /workersInvocationsAdaptive/);
	assert.equal(q.variables.accountTag, "acc");
	assert.equal(q.variables.filter.scriptName, "semics-staging-playground");
	const response = {
		data: {
			viewer: {
				accounts: [
					{
						workersInvocationsAdaptive: [{ sum: { requests: 50 }, quantiles: { cpuTimeP50: 2100, cpuTimeP99: 9800 } }],
					},
				],
			},
		},
	};
	assert.deepEqual(parseCpu(response), { requests: 50, p50Ms: 2.1, p99Ms: 9.8 });
	assert.throws(() => parseCpu({ errors: [{ message: "no" }] }), /no/);
	const verdict = compareCpu({ localMs: 20, cloudflare: { requests: 50, p50Ms: 2.1, p99Ms: 9.8 } });
	assert.equal(verdict.ok, true);
	assert.equal(verdict.ratio, 2.04);
	assert.equal(compareCpu({ localMs: 5, cloudflare: { requests: 3, p50Ms: 2, p99Ms: 60 } }).ok, false);
});

test("visitor IP: the booking's ipHash is the visitor's address, not the shared 'unknown'", async () => {
	const salt = "s".repeat(32);
	const mine = await ipHash("203.0.113.9", salt);
	assert.match(mine, /^[0-9a-f]{32}$/);
	assert.equal(mine, createHash("sha256").update(`${salt}:203.0.113.9`).digest("hex").slice(0, 32));
	assert.deepEqual(await checkVisitorIp({ stored: mine, salt, ip: "203.0.113.9" }), { ok: true, reason: "matches" });
	const unknown = await ipHash("unknown", salt);
	assert.equal((await checkVisitorIp({ stored: unknown, salt })).ok, false);
	assert.deepEqual(await checkVisitorIp({ stored: mine, salt }), { ok: true, reason: "not-unknown" });
});

test("loadVerdict: 5 booked and the rest SOLD_OUT; from one shared IP the per-IP limit may refuse too", () => {
	const ok = { booked: ["a", "b", "c", "d", "e"], refused: { SOLD_OUT: 95 } };
	assert.equal(loadVerdict(ok, { seats: 5, buyers: 100 }).ok, true);
	const shared = { booked: ["a", "b", "c", "d", "e"], refused: { SOLD_OUT: 9, RATE_LIMITED: 86 } };
	assert.equal(loadVerdict(shared, { seats: 5, buyers: 100 }).ok, false);
	assert.equal(loadVerdict(shared, { seats: 5, buyers: 100, sharedIp: true }).ok, true);
	const oversold = { booked: ["a", "b", "c", "d", "e", "f"], refused: { SOLD_OUT: 94 } };
	assert.equal(loadVerdict(oversold, { seats: 5, buyers: 100, sharedIp: true }).ok, false);
	const errored = { booked: ["a", "b", "c", "d", "e"], refused: { SOLD_OUT: 90, HTTP_500: 5 } };
	assert.equal(loadVerdict(errored, { seats: 5, buyers: 100, sharedIp: true }).ok, false);
});
