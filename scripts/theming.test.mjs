// T106 (EU-NFR-05): the UI kits are themed only through custom properties with documented defaults.
// Every `var(--events-*, default)` / `var(--esign-*, default)` in a kit's sources uses one default per
// property, and the Styling section of the site-pages guide lists each property with that default.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const VAR = /var\((--(?:events|esign)-[a-z-]+),\s*([^)]+?)\s*\)/g;

function files(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) files(path, out);
		else if (/\.(astro|ts|css)$/.test(name)) out.push(path);
	}
	return out;
}

/** property -> set of defaults used in the sources */
function properties() {
	const found = new Map();
	for (const pkg of ["events", "esign", "events-suite"]) {
		for (const file of files(join(root, "packages", pkg, "src"))) {
			for (const [, name, fallback] of readFileSync(file, "utf8").matchAll(VAR)) {
				if (!found.has(name)) found.set(name, new Set());
				found.get(name).add(fallback);
			}
		}
	}
	return found;
}

test("EU-NFR-05 each theming custom property has one default across the components", () => {
	const props = properties();
	assert.ok(props.size >= 10, "the kits use their custom properties");
	const conflicting = [...props].filter(([, defaults]) => defaults.size > 1).map(([name, d]) => `${name}: ${[...d]}`);
	assert.deepEqual(conflicting, []);
});

test("EU-NFR-05 the site-pages guide documents every theming custom property with its default", () => {
	const guide = readFileSync(join(root, "apps/docs/pages/site-pages.md"), "utf8");
	const styling = guide.slice(guide.indexOf("## Styling"));
	const missing = [];
	for (const [name, defaults] of properties()) {
		const row = styling.split("\n").find((line) => line.includes(`\`${name}\``));
		if (!row?.includes(`\`${[...defaults][0]}\``)) missing.push(`${name} (${[...defaults][0]})`);
	}
	assert.deepEqual(missing, []);
});
