// T106 (R65): the 1.0 release candidates. The three products are publishable (no longer private), share one
// 1.0.0-rc version (lockstep, §13), and Changesets is in `rc` pre mode so the release workflow publishes them
// under the `rc` dist-tag. Publishing itself stays an owner action (release-dry-run refuses the placeholder DID).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const PRODUCTS = ["events", "esign", "events-suite"];
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

test("R65 the three products are publishable and share one 1.0.0 release-candidate version", () => {
	const versions = PRODUCTS.map((dir) => {
		const pkg = read(`packages/${dir}/package.json`);
		assert.notEqual(pkg.private, true, `${pkg.name} is still private`);
		return pkg.version;
	});
	assert.match(versions[0], /^1\.0\.0-rc\.\d+$/);
	assert.deepEqual(new Set(versions).size, 1, `versions differ: ${versions}`);
	assert.equal(read("packages/shared/package.json").private, true, "the shared library is never published");
});

test("R65 Changesets is in rc pre mode", () => {
	assert.ok(existsSync(join(root, ".changeset/pre.json")));
	const pre = read(".changeset/pre.json");
	assert.equal(pre.mode, "pre");
	assert.equal(pre.tag, "rc");
});
