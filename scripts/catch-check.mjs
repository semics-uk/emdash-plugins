#!/usr/bin/env node
// T185 (#79): a server-side `catch` must report the error, rethrow it, or say why staying quiet is right.
//
//   node scripts/catch-check.mjs        lists each catch in server code with no comment, report, log or throw
//
// Server code: each package's src/ except browser code (src/client/) and Astro pages. `quietCatches` is pure.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATCH = /\bcatch\s*(\(\s*\w*\s*\))?\s*\{|\.catch\(\s*\(\s*\w*\s*\)\s*=>/;
const SAYS = /\/\/|\/\*|\*\/|^\s*\*|\breport\(|siteLog\(|\.log\.|console\.|\bthrow\b|return\s+err\(/;

/**
 * The 1-based lines of `source` holding a catch that nothing near it explains: no comment on the two lines above,
 * on its own line or on the two after, and no report, log or throw on the three after.
 * @param {string} source
 * @returns {number[]}
 */
export function quietCatches(source) {
	const lines = source.split("\n");
	const out = [];
	lines.forEach((line, i) => {
		if (!CATCH.test(line)) return;
		const near = lines.slice(Math.max(0, i - 2), i + 4).join("\n");
		if (!SAYS.test(near)) out.push(i + 1);
	});
	return out;
}

/** Server source files of every package: `src/**\/*.ts`, less browser code. */
export function serverFiles(root = repoRoot) {
	const files = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== "client" && entry.name !== "node_modules") walk(path);
			} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
		}
	};
	const packages = join(root, "packages");
	for (const pkg of readdirSync(packages, { withFileTypes: true })) {
		if (!pkg.isDirectory()) continue;
		try {
			walk(join(packages, pkg.name, "src"));
		} catch {
			// A package without src/ has nothing to check.
		}
	}
	return files;
}

export function run() {
	const found = serverFiles().flatMap((file) =>
		quietCatches(readFileSync(file, "utf8")).map((line) => `${relative(repoRoot, file)}:${line}`),
	);
	if (found.length === 0) {
		console.log("catch-check: every server catch reports, rethrows or says why it is quiet");
		return 0;
	}
	console.error(`catch-check: ${found.length} quiet catch(es) without a reason:`);
	for (const f of found) console.error(`  ${f}`);
	console.error("Report it (shared report(), or siteLog() in site code), rethrow it, or add a comment saying why.");
	return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run();
