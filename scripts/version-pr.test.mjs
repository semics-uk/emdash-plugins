import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classify, gateProblems, lockstepProblems } from "./version-pr.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = (version, extra = {}) =>
	JSON.stringify({ name: "@semics-tech/emdash-events", version, ...extra }, null, "\t");

test("a version PR's files (changesets, changelogs, version bumps) take the light path", () => {
	const result = classify([
		{ path: ".changeset/pre/t175-voucher-widget-layout.md", before: "x", after: null },
		{ path: ".changeset/pre.json", before: "{}", after: "{}" },
		{ path: "packages/events/CHANGELOG.md", before: "a", after: "b" },
		{ path: "packages/events/package.json", before: pkg("1.0.0-rc.16"), after: pkg("1.0.0-rc.17") },
	]);
	assert.equal(result.light, true, result.reason);
});

test("any other file, or a package.json change beyond its version, runs the full checks", () => {
	const cases = [
		[{ path: "packages/events/src/plugin.ts", before: null, after: null }],
		[{ path: "pnpm-lock.yaml", before: null, after: null }],
		[{ path: ".github/workflows/ci.yml", before: null, after: null }],
		[
			{
				path: "packages/events/package.json",
				before: pkg("1.0.0-rc.16"),
				after: pkg("1.0.0-rc.17", { scripts: { verify: "true" } }),
			},
		],
		[
			{
				path: "packages/events/package.json",
				before: pkg("1.0.0-rc.16", { dependencies: { a: "1" } }),
				after: pkg("1.0.0-rc.17", { dependencies: { a: "2" } }),
			},
		],
		[{ path: "packages/new/package.json", before: null, after: pkg("1.0.0") }],
		[{ path: "packages/events/package.json", before: "{", after: pkg("1.0.0") }],
		[],
	];
	for (const changes of cases) assert.equal(classify(changes).light, false, JSON.stringify(changes));
});

test("lockstep: every fixed group shares one version", () => {
	const config = { fixed: [["a", "b"]] };
	assert.deepEqual(lockstepProblems(config, { a: "1.0.0", b: "1.0.0", c: "2.0.0" }), []);
	assert.equal(lockstepProblems(config, { a: "1.0.0", b: "1.0.1" }).length, 1);
	assert.equal(lockstepProblems(config, { a: "1.0.0" }).length, 1, "a missing member is a problem");
	// The repo's own packages are in lockstep.
	const real = JSON.parse(readFileSync(join(root, ".changeset", "config.json"), "utf8"));
	assert.ok(real.fixed?.length, "the repo has a fixed group");
});

test("the pnpm verify aggregator fails unless every gate passed; on the light path only the heavy ones may skip", () => {
	const ok = { result: "success" };
	const skipped = { result: "skipped" };
	assert.deepEqual(gateProblems({ scope: ok, gates: ok, packages: ok, build: ok }, false), []);
	assert.deepEqual(gateProblems({ scope: ok, gates: ok, packages: skipped, build: skipped }, true), []);
	assert.equal(gateProblems({ scope: ok, gates: ok, packages: skipped, build: ok }, false).length, 1);
	assert.equal(gateProblems({ scope: ok, gates: ok, packages: { result: "failure" }, build: ok }, false).length, 1);
	assert.equal(gateProblems({ scope: ok, gates: ok, packages: { result: "cancelled" }, build: ok }, true).length, 1);
	assert.equal(gateProblems({ scope: ok, gates: skipped, packages: skipped, build: skipped }, true).length, 1);
	assert.equal(gateProblems({ scope: { result: "failure" }, gates: ok, packages: ok, build: ok }, false).length, 1);
	assert.equal(gateProblems({}, false).length, 1);
});

test("wait-ci passes only on a completed, successful latest pnpm verify run", async () => {
	const { ciVerdict } = await import("./version-pr.mjs");
	const run = (status, conclusion, started_at = "2026-01-01T00:00:00Z", name = "pnpm verify") => ({
		name,
		status,
		conclusion,
		started_at,
	});
	assert.equal(ciVerdict([]), "wait");
	assert.equal(ciVerdict([run("completed", "success", undefined, "Playwright")]), "wait");
	assert.equal(ciVerdict([run("in_progress", null)]), "wait");
	assert.equal(ciVerdict([run("completed", "success")]), "pass");
	for (const conclusion of ["failure", "cancelled", "skipped", "timed_out"]) {
		assert.equal(ciVerdict([run("completed", conclusion)]), "fail", conclusion);
	}
	// A re-run that passed after a failure counts: the latest run decides.
	const failed = run("completed", "failure", "2026-01-01T00:00:00Z");
	const passed = run("completed", "success", "2026-01-01T01:00:00Z");
	assert.equal(ciVerdict([failed, passed]), "pass");
});
