#!/usr/bin/env node
// 1.0 traceability report (T106): every PRD requirement in docs/requirements/prd.json maps to a test.
//
//   node scripts/traceability.mjs [--pro <Pro repo dir>] [--markdown]
//
// A requirement is traced when its id appears in the title line of a test that runs: an `it(`,
// `test(` or `describe(` call (Vitest, Playwright or node:test), not `.skip` or `.todo`. `pnpm verify`
// runs every such test, so a traced requirement maps to a passing test. A Free requirement must be
// traced in this repo; a Pro one in this repo or in the Pro repo (`--pro`). A requirement with a
// `check` has no automated test and is listed with its reason. Exits 1 when anything is untraced.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".claude", "coverage", ".astro", "test-results"]);
const TEST_FILE = /\.(test|spec)\.(m?[jt]sx?)$/;
const TITLE_LINE =
	/\b(?:it|test|describe)(?:\.(?:each\b[^(]*\([^)]*\)|only|concurrent|serial|sequential|describe|parallel))*\s*\(/;
const NOT_RUN = /\b(?:it|test|describe)(?:\.\w+)*\.(?:skip|todo|fixme)\b/;
const ID = /\b(?:EV|ES|EU|SU|SX)-N?FR-\d{2}\b/g;

export function loadRequirements(file = join(repoRoot, "docs", "requirements", "prd.json")) {
	return JSON.parse(readFileSync(file, "utf8")).requirements;
}

export function testFiles(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) testFiles(path, out);
		else if (TEST_FILE.test(name)) out.push(path);
	}
	return out;
}

/** Requirement ids named in runnable test titles: Map<id, Set<relative file>>. */
export function tracedIds(files, root) {
	const traced = new Map();
	for (const file of files) {
		for (const line of readFileSync(file, "utf8").split("\n")) {
			if (!TITLE_LINE.test(line) || NOT_RUN.test(line)) continue;
			for (const id of line.match(ID) ?? []) {
				if (!traced.has(id)) traced.set(id, new Set());
				traced.get(id).add(relative(root, file));
			}
		}
	}
	return traced;
}

export function trace(requirements, publicTraced, proTraced = null) {
	return requirements.map((r) => {
		const here = [...(publicTraced.get(r.id) ?? [])];
		const pro = proTraced ? [...(proTraced.get(r.id) ?? [])] : [];
		let status;
		if (r.check) status = "checked-otherwise";
		else if (here.length > 0) status = "traced";
		else if (r.edition === "pro" && pro.length > 0) status = "traced";
		else if (r.edition === "pro" && !proTraced) status = "pro-not-checked";
		else status = "untraced";
		return { ...r, status, files: here, proFiles: pro };
	});
}

export function markdown(rows) {
	const lines = ["| Requirement | Edition | Status | Tests (files) |", "| --- | --- | --- | --- |"];
	for (const r of rows) {
		const where =
			r.status === "checked-otherwise"
				? r.check
				: `${r.files.length} public${r.proFiles.length ? `, ${r.proFiles.length} Pro` : ""}${r.files[0] ? `: ${r.files[0]}` : r.proFiles[0] ? `: Pro ${r.proFiles[0]}` : ""}`;
		lines.push(`| ${r.id} ${r.title} | ${r.edition} | ${r.status} | ${where} |`);
	}
	return lines.join("\n");
}

function main(argv) {
	const proIndex = argv.indexOf("--pro");
	const proRoot = proIndex === -1 ? null : resolve(argv[proIndex + 1] ?? "");
	const rows = trace(
		loadRequirements(),
		tracedIds(testFiles(repoRoot), repoRoot),
		proRoot ? tracedIds(testFiles(proRoot), proRoot) : null,
	);
	if (argv.includes("--markdown")) console.log(markdown(rows));
	const count = (s) => rows.filter((r) => r.status === s).length;
	console.log(
		`${rows.length} requirements: ${count("traced")} traced, ${count("checked-otherwise")} checked otherwise, ${count("pro-not-checked")} Pro (run with --pro), ${count("untraced")} untraced`,
	);
	const untraced = rows.filter((r) => r.status === "untraced");
	for (const r of untraced) console.error(`untraced: ${r.id} ${r.title}`);
	return untraced.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(main(process.argv.slice(2)));
}
