// T106 (EV-NFR-07, BUILD-PLAN §9): both cores declare the EmDash range they support in the manifest, so the
// registry and EmDash refuse an install on a host outside it, and it equals the npm peer range.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const RANGE = ">=1.2.0 <2";

/** JSONC with whole-line comments only, as the manifests are written. */
function readJsonc(path) {
	const text = readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n")
		.replace(/,(\s*[}\]])/g, "$1");
	return JSON.parse(text);
}

for (const pkg of ["events", "esign"]) {
	test(`EV-NFR-07 ${pkg}: the manifest requires env:emdash ${RANGE}, the npm peer range`, () => {
		const manifest = readJsonc(join(root, "packages", pkg, "emdash-plugin.jsonc"));
		const npm = JSON.parse(readFileSync(join(root, "packages", pkg, "package.json"), "utf8"));
		assert.deepEqual(manifest.release?.requires, { "env:emdash": RANGE });
		assert.equal(npm.peerDependencies?.emdash, RANGE);
	});
}
