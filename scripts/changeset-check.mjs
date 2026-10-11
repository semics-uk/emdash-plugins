#!/usr/bin/env node
// Fails when a published package changed without a changeset that names it.
//
//   node scripts/changeset-check.mjs [--base <ref>]     (base defaults to main)
//
// The decision is the pure function `checkChangesets`; the CLI only gathers its inputs from
// `git diff --name-only <base>...HEAD`, the published packages and `.changeset/*.md`.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** Directories under `packages/` that are never published. */
const UNPUBLISHED_PACKAGE_DIRS = new Set(["shared"]);

/**
 * @param {{
 *   changedFiles: string[],
 *   changesets: { file: string, packages: string[] }[],
 *   published: { name: string, dir: string }[],
 *   dependencyChanges?: string[],
 * }} input `dependencyChanges` lists the dirs of published packages whose package.json
 *   dependencies differ from the base.
 * @returns {{ ok: boolean, required: string[], missing: string[] }}
 */
export function checkChangesets({ changedFiles, changesets, published, dependencyChanges = [] }) {
	const named = new Set(changesets.flatMap((changeset) => changeset.packages));
	const required = published
		.filter(({ dir }) => {
			const touchesShipped = changedFiles.some(
				(file) => file.startsWith(`${dir}/src/`) || file === `${dir}/emdash-plugin.jsonc`,
			);
			return touchesShipped || dependencyChanges.includes(dir);
		})
		.map(({ name }) => name);
	const missing = required.filter((name) => !named.has(name));
	return { ok: missing.length === 0, required, missing };
}

/** The package names in a changeset file's front matter. */
export function parseChangesetPackages(body) {
	const match = /^---\r?\n([\s\S]*?)\r?\n?---/.exec(body);
	if (!match) return [];
	return match[1]
		.split(/\r?\n/)
		.map((line) => /^\s*["']?([^"':]+)["']?\s*:\s*\S+/.exec(line)?.[1])
		.filter(Boolean);
}

function git(args) {
	const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
	return result.status === 0 ? result.stdout : null;
}

export function currentBranch() {
	return git(["branch", "--show-current"])?.trim() ?? "";
}

function publishedPackages() {
	const packagesDir = join(repoRoot, "packages");
	return readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !UNPUBLISHED_PACKAGE_DIRS.has(entry.name))
		.filter((entry) => existsSync(join(packagesDir, entry.name, "package.json")))
		.map((entry) => {
			const dir = `packages/${entry.name}`;
			return { dir, name: JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8")).name };
		});
}

function dependencies(json) {
	return JSON.stringify(DEPENDENCY_FIELDS.map((field) => json?.[field] ?? {}));
}

function dependencyChanges(published, changedFiles, base) {
	return published
		.filter(({ dir }) => changedFiles.includes(`${dir}/package.json`))
		.filter(({ dir }) => {
			const before = git(["show", `${base}:${dir}/package.json`]);
			const now = JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
			return before === null || dependencies(JSON.parse(before)) !== dependencies(now);
		})
		.map(({ dir }) => dir);
}

function readChangesets() {
	const dir = join(repoRoot, ".changeset");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md")
		.map((file) => ({ file, packages: parseChangesetPackages(readFileSync(join(dir, file), "utf8")) }));
}

export function run(argv) {
	const i = argv.indexOf("--base");
	const base = i === -1 ? "main" : (argv[i + 1] ?? "main");
	const diff = git(["diff", "--name-only", `${base}...HEAD`]);
	if (diff === null) {
		console.error(`changeset-check: cannot diff against "${base}" (is the ref present?)`);
		return 1;
	}
	const changedFiles = diff.split("\n").filter(Boolean);
	const published = publishedPackages();
	const result = checkChangesets({
		changedFiles,
		changesets: readChangesets(),
		published,
		dependencyChanges: dependencyChanges(published, changedFiles, base),
	});
	if (result.ok) {
		console.log(
			result.required.length
				? `changeset-check: changesets present for ${result.required.join(", ")}`
				: "changeset-check: no published package changed",
		);
		return 0;
	}
	console.error(`changeset-check: missing a changeset for ${result.missing.join(", ")}`);
	console.error("Run `pnpm changeset` and name each package listed above (see CONTRIBUTING.md).");
	return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(run(process.argv.slice(2)));
}
