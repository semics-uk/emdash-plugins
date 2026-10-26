// T106 (R65): the 1.0 release candidates. The three products are publishable (no longer private), share one
// 1.0.0-rc version (lockstep, §13), and Changesets is in `rc` pre mode so the release workflow publishes them
// under the `rc` dist-tag. Publishing itself stays an owner action (release-dry-run refuses the placeholder DID).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
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

// T123: Changesets CLI 3 keeps pre mode as `{ mode, tag }` (what `changeset pre enter rc` writes) and moves the
// changesets a pre-release consumed into .changeset/pre/. The 2.x shape (initialVersions, changesets) is
// migrated away by CLI 3 on first read, so it must not come back; the release action must read this layout.
test("T123 the rc pre-mode layout is Changesets 3's, with the rc.0 changesets consumed in .changeset/pre/", async () => {
	const cli = JSON.parse(readFileSync(join(root, "node_modules/@changesets/cli/package.json"), "utf8"));
	assert.ok(Number(cli.version.split(".")[0]) >= 3, `@changesets/cli ${cli.version}`);
	assert.deepEqual(Object.keys(read(".changeset/pre.json")).sort(), ["mode", "tag"]);
	const consumed = readdirSync(join(root, ".changeset/pre")).filter((file) => file.endsWith(".md"));
	assert.ok(consumed.includes("release-1-0.md"), "the 1.0 changeset is consumed by rc.0");
	for (const entry of readdirSync(join(root, ".changeset"), { withFileTypes: true })) {
		assert.ok(entry.isFile() || entry.name === "pre", `unexpected .changeset/${entry.name}`);
	}

	// Changesets' own reader (the one changesets/action v2 uses) accepts the layout.
	const req = createRequire(realpathSync(join(root, "node_modules/@changesets/cli/package.json")));
	const ids = (await req("@changesets/read").default(root)).map((c) => c.id);
	for (const file of consumed) assert.ok(ids.includes(`pre/${file.replace(/\.md$/, "")}`), file);

	const release = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
	assert.match(release, /uses: changesets\/action@[0-9a-f]{40} # v2\./, "action v1 cannot read .changeset/pre/");
});
