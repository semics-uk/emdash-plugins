// T106: the 1.0 traceability report. Every PRD requirement maps to a test that runs in `pnpm verify`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadRequirements, testFiles, trace, tracedIds } from "./traceability.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;

function fixture(files) {
	const dir = mkdtempSync(join(tmpdir(), "trace-"));
	for (const [name, body] of Object.entries(files)) {
		mkdirSync(join(dir, name, ".."), { recursive: true });
		writeFileSync(join(dir, name), body);
	}
	return dir;
}

test("only ids in runnable test titles count", () => {
	const dir = fixture({
		"a.test.ts": [
			'it("EV-FR-01 maps the collection", () => {});',
			'describe("checkout (EV-FR-05, R30)", () => {});',
			'test.describe("EU-NFR-07 at 320 px", () => {});',
			'it.skip("EV-FR-02 skipped", () => {});',
			'test.fixme("EV-FR-03 broken", () => {});',
			"// EV-FR-04 in a comment",
			'const note = "EV-FR-06 in a string";',
		].join("\n"),
		"b.ts": 'it("EV-FR-07 not a test file", () => {});',
		"node_modules/x/c.test.ts": 'it("EV-FR-08 a dependency", () => {});',
	});
	const traced = tracedIds(testFiles(dir), dir);
	assert.deepEqual([...traced.keys()].sort(), ["EU-NFR-07", "EV-FR-01", "EV-FR-05"]);
	assert.deepEqual([...traced.get("EV-FR-01")], ["a.test.ts"]);
});

test("a Pro requirement may be traced in the Pro repo; a Free one only here", () => {
	const reqs = [
		{ id: "EV-FR-01", edition: "free", title: "free" },
		{ id: "EV-FR-13", edition: "pro", title: "pro" },
		{ id: "SU-FR-13", edition: "free", title: "n/a", check: "Not applicable" },
	];
	const none = new Map();
	const pro = new Map([
		["EV-FR-13", new Set(["p.test.ts"])],
		["EV-FR-01", new Set(["p.test.ts"])],
	]);
	assert.deepEqual(
		trace(reqs, none).map((r) => r.status),
		["untraced", "pro-not-checked", "checked-otherwise"],
	);
	assert.deepEqual(
		trace(reqs, none, pro).map((r) => r.status),
		["untraced", "traced", "checked-otherwise"],
	);
});

test("the requirement list is the five PRDs' FR and NFR ids, each once", () => {
	const reqs = loadRequirements();
	const ids = reqs.map((r) => r.id);
	assert.equal(new Set(ids).size, ids.length);
	const count = (prefix) => ids.filter((id) => id.startsWith(prefix)).length;
	// EV-FR-01..20, EV-NFR-01..08, ES-FR-01..22, ES-NFR-01..07, EU-FR-01..11, EU-NFR-01..07,
	// SU-FR-01..13, SU-NFR-01..06, SX-FR-01..08, SX-NFR-01..06.
	assert.deepEqual(
		["EV-FR", "EV-NFR", "ES-FR", "ES-NFR", "EU-FR", "EU-NFR", "SU-FR", "SU-NFR", "SX-FR", "SX-NFR"].map(count),
		[20, 8, 22, 7, 11, 7, 13, 6, 8, 6],
	);
	for (const r of reqs) {
		assert.ok(["free", "pro"].includes(r.edition), r.id);
		assert.ok(r.title.length > 0, r.id);
	}
});

test("every Free PRD requirement maps to a test in this repo (1.0 traceability)", () => {
	const rows = trace(loadRequirements(), tracedIds(testFiles(repoRoot), repoRoot));
	const untraced = rows.filter((r) => r.status === "untraced").map((r) => r.id);
	assert.deepEqual(untraced, []);
	const otherwise = rows.filter((r) => r.status === "checked-otherwise").map((r) => r.id);
	assert.deepEqual(otherwise, ["SU-FR-13"]);
});
