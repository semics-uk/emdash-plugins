import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The native UI halves ship as source or tsc output, not through the sandbox bundler, so they cannot
// import the private, source-only @semics-tech/shared: a published install would fail to resolve it.
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const UI_DIRS = ["src/astro", "src/client", "src/ui", "src/integration"];

function files(dir) {
	let out = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of entries) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out = out.concat(files(path));
		else if (/\.(ts|js|mjs|astro|tsx)$/.test(name)) out.push(path);
	}
	return out;
}

// The suite (T065) is native code only, so all of its `src` counts.
const PACKAGES = [
	["events", UI_DIRS],
	["esign", UI_DIRS],
	["events-suite", ["src"]],
];

for (const [pkg, dirs] of PACKAGES) {
	test(`${pkg} UI code never imports @semics-tech/shared`, () => {
		const scanned = dirs.flatMap((dir) => files(join(repoRoot, "packages", pkg, dir)));
		assert.ok(scanned.length > 0, `no UI sources found in packages/${pkg}`);
		const offenders = scanned.filter((path) =>
			/["']@semics-tech\/shared(\/[^"']*)?["']/.test(readFileSync(path, "utf8")),
		);
		assert.deepEqual(
			offenders.map((path) => relative(repoRoot, path)),
			[],
		);
	});
}
