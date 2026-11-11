import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EVENTS_BUNDLE_BUDGET, EVENTS_HOTFIX_ROOM, REGISTRY_FILE_LIMIT, report, sizes } from "./bundle-size.mjs";

test("the script's limits match the enforced ones in shared/testing/bundle-size.ts", () => {
	const enforced = readFileSync(new URL("../packages/shared/testing/bundle-size.ts", import.meta.url), "utf8");
	assert.equal(REGISTRY_FILE_LIMIT, 128 * 1024);
	assert.match(enforced, /REGISTRY_FILE_LIMIT = 128 \* 1024/);
	assert.match(enforced, /EVENTS_BUNDLE_BUDGET = REGISTRY_FILE_LIMIT - 3 \* 1024/);
	assert.match(enforced, /EVENTS_HOTFIX_ROOM = 4 \* 1024/);
	assert.equal(EVENTS_BUNDLE_BUDGET, REGISTRY_FILE_LIMIT - 3 * 1024);
	assert.equal(EVENTS_HOTFIX_ROOM, 4 * 1024);
});

test("report lists each bundle's bytes and room; Events also its room under budget less hotfix room", () => {
	const md = report([
		{ name: "esign", bytes: 100_000 },
		{ name: "events", bytes: 119_445 },
	]);
	assert.match(md, /\| esign \| 100,000 \| 31,072 \| {2}\|/);
	assert.match(md, /\| events \| 119,445 \| 11,627 \| 4,459 \|/);
});

test("sizes reads every packages/*/dist/plugin.mjs and skips packages without one", () => {
	const root = mkdtempSync(join(tmpdir(), "bundle-size-"));
	mkdirSync(join(root, "packages", "events", "dist"), { recursive: true });
	mkdirSync(join(root, "packages", "shared"), { recursive: true });
	writeFileSync(join(root, "packages", "events", "dist", "plugin.mjs"), "x".repeat(42));
	assert.deepEqual(sizes(root), [{ name: "events", bytes: 42 }]);
	assert.match(report([]), /nothing built/);
});
