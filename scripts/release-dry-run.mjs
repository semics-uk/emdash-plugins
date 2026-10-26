#!/usr/bin/env node
// Release dry run: builds, packs and audits every publishable package without publishing anything.
//
//   node scripts/release-dry-run.mjs [--build] [--release] [--require-real-did] [--package <name>]
//
// For each publishable package (everything under packages/ except the private-by-design
// @semics-tech/shared) it
//   1. optionally builds it (--build),
//   2. runs `pnpm pack` and audits the npm tarball,
//   3. runs `emdash-plugin bundle` and audits the registry tarball,
// then reports. It never logs in, uploads or publishes, and writes only to a temp directory.
//
// The audit asserts the expected files are there and nothing private is: no tests, `.env`, coverage,
// keys, Pro code or licence material, no runtime import of @semics-tech/shared in shipped UI (R35),
// no unresolved `workspace:` dependency.
//
// Release blockers (a publisher other than the semics DID from R86, a package still marked private)
// are warnings in a plain dry run. `--release` turns them into failures; `--require-real-did` fails on
// the publisher alone (the registry workflow uses it). Exit code 0 means clean.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** R86: the publisher every manifest must name (handle semics.co.uk). */
export const PUBLISHER_DID = "did:plc:mire6xkehfirmoj5pmpqgpvq";

/** Private by design: source-only, inlined by the sandbox bundler, never published. */
const NEVER_PUBLISHED = new Set(["@semics-tech/shared"]);

const DEFAULT_EXPECTED = [
	"package.json",
	"LICENSE",
	"README.md",
	"emdash-plugin.jsonc",
	"dist/index.mjs",
	"dist/plugin.mjs",
	"dist/manifest.json",
];

const FORBIDDEN_PATHS = [
	[/(^|\/)tests?\//, "test directory"],
	[/\.(test|spec)\.[cm]?[jt]sx?$/, "test file"],
	[/(^|\/)\.env(\.|$)/, "environment file"],
	[/(^|\/)coverage\//, "coverage output"],
	[/\.log$/, "log file"],
	[/(^|\/)node_modules\//, "node_modules"],
	[/(^|\/)\.claude\//, "agent tooling"],
	[/(^|\/)vitest[^/]*\.[cm]?[jt]s$/, "test config"],
	[/(^|\/)tsconfig[^/]*\.json$/, "tooling config"],
	[/\.(pem|key|p12|pfx)$/, "key material"],
	[/(^|\/)pro\.json$/, "Pro code"],
	[/(^|\/)generated\//, "generated Pro build constants"],
	[/(^|\/)licence\//, "licence material"],
	[/(^|\/)pro-kit\//, "Pro code"],
];

const PRO_NAMES = /@semics-tech\/pro-kit|emdash-events-pro|emdash-esign-pro/;
const SHARED_IMPORT = /["']@semics-tech\/shared(\/[^"']*)?["']/;
const SECRETS = [
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
	[/\bnpm_[A-Za-z0-9]{36}\b/, "an npm token"],
	[/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, "a GitHub token"],
];
const NATIVE_UI = /^(src\/(astro|client|ui|integration)|dist\/ts)\//;
const isDoc = (path) => /\.md$/i.test(path);

function contentProblems(entries) {
	const problems = [];
	for (const [path, text] of entries) {
		if (path === "package.json") continue;
		if (!isDoc(path)) {
			if (PRO_NAMES.test(text)) problems.push(`${path}: references a Pro package`);
			if (SHARED_IMPORT.test(text)) {
				problems.push(
					NATIVE_UI.test(path)
						? `${path}: imports @semics-tech/shared; native UI must not (R35)`
						: `${path}: imports @semics-tech/shared, which is private and must be inlined`,
				);
			}
		}
		for (const [pattern, what] of SECRETS) if (pattern.test(text)) problems.push(`${path}: contains ${what}`);
	}
	return problems;
}

function pathProblems(entries) {
	const problems = [];
	for (const path of entries.keys()) {
		for (const [pattern, what] of FORBIDDEN_PATHS) {
			if (pattern.test(path)) {
				problems.push(`${path}: ${what} must not be shipped`);
				break;
			}
		}
	}
	return problems;
}

/** Problems with an npm tarball (path without the `package/` prefix -> text). Empty means clean. */
export function auditTarball({ name, entries, expected = DEFAULT_EXPECTED }) {
	const problems = [];
	for (const path of expected) if (!entries.has(path)) problems.push(`missing expected file ${path}`);
	problems.push(...pathProblems(entries), ...contentProblems(entries));
	const raw = entries.get("package.json");
	if (raw !== undefined) {
		let pkg;
		try {
			pkg = JSON.parse(raw);
		} catch {
			return [...problems, "package.json is not valid JSON"];
		}
		if (pkg.name !== name) problems.push(`package.json name is ${pkg.name}, expected ${name}`);
		for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
			for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
				if (dep === "@semics-tech/shared") problems.push(`${field} lists @semics-tech/shared, which is private`);
				if (String(range).startsWith("workspace:")) problems.push(`${field}.${dep} is still workspace: (${range})`);
			}
		}
	}
	return problems;
}

/** Problems with the registry tarball made by `emdash-plugin bundle`. */
export function auditBundle({ entries }) {
	const problems = [];
	for (const path of ["manifest.json", "backend.js"]) if (!entries.has(path)) problems.push(`missing ${path}`);
	problems.push(...pathProblems(entries), ...contentProblems(entries));
	return problems;
}

/** What stops a real release, as opposed to a dry run. `manifest` is null for an npm-only package. */
export function releaseBlockers({ manifest, pkg }) {
	const blockers = [];
	if (manifest && manifest.publisher !== PUBLISHER_DID) {
		blockers.push(`publisher is ${manifest.publisher}, not the semics publisher DID ${PUBLISHER_DID} (R86)`);
	}
	if (pkg.private) blockers.push(`${pkg.name} is still "private": true; remove it for the first npm publish`);
	return blockers;
}

/** Extracts a .tgz or .tar.gz into path -> text, dropping a leading `package/` directory. */
export function readTarball(file) {
	const dir = mkdtempSync(join(tmpdir(), "release-tar-"));
	try {
		const result = spawnSync("tar", ["-xzf", file, "-C", dir], { encoding: "utf8" });
		if (result.status !== 0) throw new Error(`tar failed for ${file}: ${result.stderr}`);
		const entries = new Map();
		const walk = (current) => {
			for (const name of readdirSync(current)) {
				const full = join(current, name);
				if (statSync(full).isDirectory()) walk(full);
				else entries.set(relative(dir, full).replace(/^package\//, ""), readFileSync(full, "utf8"));
			}
		};
		walk(dir);
		return entries;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Every package under packages/ that gets published, with its directory and package.json. */
export function publishablePackages(root = repoRoot) {
	const packagesDir = join(root, "packages");
	const out = [];
	for (const dirName of readdirSync(packagesDir).sort()) {
		const dir = join(packagesDir, dirName);
		const pkgFile = join(dir, "package.json");
		if (!existsSync(pkgFile)) continue;
		const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
		if (NEVER_PUBLISHED.has(pkg.name)) continue;
		const hasManifest = existsSync(join(dir, "emdash-plugin.jsonc"));
		out.push({
			dir,
			name: pkg.name,
			pkg,
			hasManifest,
			expected: hasManifest ? DEFAULT_EXPECTED : ["package.json", "LICENSE", "README.md"],
		});
	}
	return out;
}

/** `publisher` from a JSONC manifest (comments make JSON.parse unusable; a regex is enough here). */
export function readPublisher(manifestText) {
	return /"publisher"\s*:\s*"([^"]+)"/.exec(manifestText)?.[1];
}

function run(cmd, args, cwd) {
	const result = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (result.status !== 0) {
		throw new Error(
			`${cmd} ${args.join(" ")} failed in ${relative(repoRoot, cwd) || "."}\n${result.stdout}${result.stderr}`,
		);
	}
	return result.stdout;
}

function dryRunPackage(candidate, { build }, scratch) {
	const { dir, name, pkg, hasManifest, expected } = candidate;
	if (build) run("pnpm", ["--filter", name, "build"], repoRoot);
	if (hasManifest && !existsSync(join(dir, "dist", "plugin.mjs"))) {
		throw new Error(`${name} is not built: run with --build (or \`pnpm build\`) first`);
	}
	const out = join(scratch, name.replace(/[@/]/g, "_"));
	run("pnpm", ["pack", "--pack-destination", out], dir);
	const tgz = readdirSync(out).find((f) => f.endsWith(".tgz"));
	const entries = readTarball(join(out, tgz));
	const problems = auditTarball({ name, entries, expected }).map((p) => `npm tarball: ${p}`);
	let bundleFiles = 0;
	if (hasManifest) {
		const bundleOut = join(out, "bundle");
		run("pnpm", ["exec", "emdash-plugin", "bundle", "--out-dir", bundleOut], dir);
		const archive = readdirSync(bundleOut).find((f) => /\.tar\.gz$/.test(f));
		if (!archive) problems.push("registry bundle: emdash-plugin bundle produced no .tar.gz");
		else {
			const bundle = readTarball(join(bundleOut, archive));
			bundleFiles = bundle.size;
			problems.push(...auditBundle({ entries: bundle }).map((p) => `registry bundle: ${p}`));
		}
	}
	const manifest = hasManifest
		? { publisher: readPublisher(readFileSync(join(dir, "emdash-plugin.jsonc"), "utf8")) }
		: null;
	const blockers = releaseBlockers({ manifest, pkg });
	return { name, version: pkg.version, files: entries.size, bundleFiles, problems, blockers };
}

export function main(argv = process.argv.slice(2)) {
	const flag = (f) => argv.includes(f);
	const only = argv.includes("--package") ? argv[argv.indexOf("--package") + 1] : undefined;
	const release = flag("--release");
	const requireRealDid = flag("--require-real-did");
	const candidates = publishablePackages().filter((c) => !only || c.name === only);
	if (candidates.length === 0) {
		console.error("release dry run: no publishable packages found");
		return 1;
	}
	const scratch = mkdtempSync(join(tmpdir(), "release-dry-run-"));
	let failed = false;
	try {
		for (const candidate of candidates) {
			const r = dryRunPackage(candidate, { build: flag("--build") }, scratch);
			const hard = [...r.problems];
			const soft = [];
			for (const blocker of r.blockers) {
				const isDid = blocker.includes("publisher DID");
				(release || (requireRealDid && isDid) ? hard : soft).push(`release blocker: ${blocker}`);
			}
			console.log(
				`${hard.length ? "✖" : "✔"} ${r.name}@${r.version}: ${r.files} files in the npm tarball, ${r.bundleFiles} in the registry bundle`,
			);
			for (const line of hard) console.log(`    ${line}`);
			for (const line of soft) console.log(`    note (not blocking a dry run): ${line}`);
			if (hard.length) failed = true;
		}
	} catch (error) {
		console.error(`✖ release dry run: ${error.message}`);
		failed = true;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
	console.log(failed ? "release dry run failed" : "release dry run clean: nothing was published");
	return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
