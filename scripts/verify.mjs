#!/usr/bin/env node
// `pnpm verify`: every quality gate, cheapest first, stopping at the first failure.
//
//   node scripts/verify.mjs [--root <dir>] [--verbose] [--group lint|packages|build [--package <dir>]]
//
// Plain, it runs every gate in order: that is the local command. CI (ci.yml) runs the same gates split by
// --group across parallel jobs: `lint` (Biome, board, script tests, changeset and lockstep checks),
// `packages --package <dir>` (one package's validate, typecheck, tests and build, after building the
// workspace packages it depends on) and `build` (builds every package, then docs, product site, release
// dry run and the playground typecheck). Every gate belongs to exactly one group.
//
// Quiet by default: a passing gate prints one line; a failing gate prints its last 200 lines.
// Every gate's full output is written to .verify.log. --verbose streams output as it runs.
//
// --root points the Biome gate (and the later steps) at another directory; the tests use it to
// prove that a deliberately broken project makes verify exit non-zero.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentBranch } from "./changeset-check.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseRoot(argv) {
	const i = argv.indexOf("--root");
	return i === -1 ? repoRoot : resolve(argv[i + 1] ?? "");
}

export const GROUPS = ["lint", "packages", "build"];

const pnpm = (...args) => ({ cmd: "pnpm", args });

export function steps(root) {
	const biome = join(repoRoot, "node_modules", ".bin", "biome");
	return [
		{ group: "lint", name: "Biome lint and format check", cmd: biome, args: ["ci", "."] },
		{ group: "lint", name: "Task board check", ...pnpm("run", "tasks:check") },
		{ group: "lint", name: "Script tests", ...pnpm("run", "test:scripts") },
		{
			group: "lint",
			name: "Changeset check",
			...pnpm("run", "changeset:check"),
			skip: currentBranch() === "main" ? "on main: nothing to compare against" : undefined,
		},
		{
			group: "lint",
			name: "Fixed package versions in lockstep",
			cmd: process.execPath,
			args: [join(repoRoot, "scripts", "version-pr.mjs"), "lockstep"],
		},
		{
			group: "packages",
			name: "Packages: validate, typecheck, tests with coverage, build",
			// One package at a time: each suite starts workerd sandboxes, and running them together pushed
			// single invocations past the host's 30 s wall-time limit. CI gives each package its own runner.
			...pnpm("-r", "--workspace-concurrency=1", "--filter", "./packages/**", "verify"),
		},
		// After the packages: the docs' snippets import their built entry points (T103).
		{ group: "build", name: "Docs: build, links, snippets and listings", ...pnpm("--filter", "docs", "verify") },
		{
			group: "build",
			name: "Product site: pages, prices, legal text, links (T124)",
			...pnpm("--filter", "site", "verify"),
		},
		// Packs and audits what would be published (the packages were just built); publishes nothing.
		{ group: "build", name: "Release dry run (pack and audit)", ...pnpm("run", "release:dry-run") },
		{ group: "build", name: "Playground typecheck", ...pnpm("--filter", "playground", "typecheck") },
	].map((step) => ({ ...step, cwd: root }));
}

function readPackages(root) {
	const dir = join(root, "packages");
	return readdirSync(dir)
		.filter((name) => existsSync(join(dir, name, "package.json")))
		.map((name) => ({ dir: name, json: JSON.parse(readFileSync(join(dir, name, "package.json"), "utf8")) }));
}

/** Dirs under packages/ with a verify script, sorted: the CI package matrix. */
export function verifiablePackages(root = repoRoot) {
	return readPackages(root)
		.filter(({ json }) => json.scripts?.verify)
		.map(({ dir }) => dir)
		.sort();
}

/** Names of the workspace packages that packages/`pkgDir` depends on, transitively, with a build script. */
export function buildDependencies(pkgDir, root = repoRoot) {
	const packages = readPackages(root);
	const byName = new Map(packages.map(({ json }) => [json.name, json]));
	const seen = new Set();
	const visit = (json) => {
		const ranges = { ...json.dependencies, ...json.devDependencies, ...json.peerDependencies };
		for (const [dep, range] of Object.entries(ranges)) {
			if (!String(range).startsWith("workspace:") || !byName.has(dep) || seen.has(dep)) continue;
			seen.add(dep);
			visit(byName.get(dep));
		}
	};
	const own = packages.find(({ dir }) => dir === pkgDir);
	if (!own) throw new Error(`no package at packages/${pkgDir}`);
	visit(own.json);
	return [...seen].filter((dep) => byName.get(dep).scripts?.build).sort();
}

/** One CI group's steps (see the header); `pkg` narrows the packages group to one package dir. */
export function groupSteps(root, group, pkg) {
	if (!GROUPS.includes(group)) throw new Error(`unknown verify group "${group}" (one of ${GROUPS.join(", ")})`);
	if (pkg !== undefined && group !== "packages") throw new Error("--package only applies to --group packages");
	if (group === "packages" && pkg !== undefined) {
		if (!verifiablePackages(root).includes(pkg)) throw new Error(`packages/${pkg} has no verify script`);
		const deps = buildDependencies(pkg, root);
		const build = deps.length
			? [
					{
						name: `Build what ${pkg} depends on (${deps.join(", ")})`,
						...pnpm(...deps.flatMap((d) => ["--filter", d]), "build"),
					},
				]
			: [];
		return [
			...build,
			{
				name: `packages/${pkg}: validate, typecheck, tests with coverage, build`,
				...pnpm("--filter", `./packages/${pkg}`, "verify"),
			},
		].map((step) => ({ ...step, group, cwd: root }));
	}
	const selected = steps(root).filter((step) => step.group === group);
	// On its own the build group has no package build before it, so it starts with one (no tests).
	if (group === "build")
		return [{ group, name: "Build every package", ...pnpm("run", "build"), cwd: root }, ...selected];
	return selected;
}

const TAIL_LINES = 200;

export function verify(root, stepList = steps(root), { verbose = false, logFile = join(root, ".verify.log") } = {}) {
	writeFileSync(logFile, `verify started ${new Date().toISOString()}\n`);
	for (const step of stepList) {
		if (step.skip) {
			console.log(`- ${step.name}: skipped (${step.skip})`);
			continue;
		}
		const started = Date.now();
		if (verbose) console.log(`\n== ${step.name}`);
		const result = spawnSync(step.cmd, step.args, {
			cwd: step.cwd,
			stdio: verbose ? "inherit" : "pipe",
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
		});
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		appendFileSync(logFile, `\n== ${step.name} (exit ${result.status}, ${seconds}s)\n${output}`);
		if (result.error) {
			console.error(
				`✖ ${step.name}\nverify failed at: ${step.name}: could not start "${step.cmd}" (${result.error.code ?? result.error.message}). Is it on PATH?`,
			);
			return 1;
		}
		if (result.status !== 0) {
			const lines = output.trimEnd().split("\n");
			const tail = lines.slice(-TAIL_LINES).join("\n");
			console.error(`✖ ${step.name} (${seconds}s)`);
			if (!verbose) {
				if (lines.length > TAIL_LINES) console.error(`… ${lines.length - TAIL_LINES} earlier lines in ${logFile}`);
				console.error(tail);
			}
			console.error(`\nverify failed at: ${step.name}. Full log: ${logFile}`);
			return result.status || 1;
		}
		console.log(`✔ ${step.name} (${seconds}s)`);
	}
	console.log(`verify passed. Full log: ${logFile}`);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const argv = process.argv.slice(2);
	const root = parseRoot(argv);
	const value = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
	const group = value("--group");
	const stepList = group === undefined ? undefined : groupSteps(root, group, value("--package"));
	process.exit(verify(root, stepList, { verbose: argv.includes("--verbose") }));
}
