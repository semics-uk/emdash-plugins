#!/usr/bin/env node
// npm trusted publishing (BUILD-PLAN R84): the release workflow publishes with a short-lived GitHub
// OIDC token, so no npm token is stored anywhere.
//
//   node scripts/npm-trust.mjs check-npm             CI: fail unless npm >= 11.5.1 (OIDC exchange)
//   node scripts/npm-trust.mjs bootstrap             owner: print the first-publish plan, change nothing
//   node scripts/npm-trust.mjs bootstrap --publish   owner, once, after `npm login`: run that plan
//
// npm only lets a trusted publisher be added to a package that already exists. For each publishable
// package not yet on npm, `bootstrap --publish` publishes an empty placeholder (`0.0.0-bootstrap.0`,
// dist-tag `bootstrap`, no code), deprecates it, then runs `npm trust github` for the release workflow.
// The first real version then comes from CI, with provenance. Run it from the owner's laptop (npm
// >= 11.15.0, 2FA on the account); a new trusted publisher must see its first publish within 2 days.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./release-dry-run.mjs";

/** npm CLI that exchanges a GitHub OIDC token for a publish token (docs.npmjs.com/trusted-publishers). */
export const MIN_NPM_PUBLISH = [11, 5, 1];
/** npm CLI with `npm trust` (docs.npmjs.com/cli/v11/commands/npm-trust). */
export const MIN_NPM_TRUST = [11, 15, 0];

/** What each package's trusted publisher on npmjs.com must say. */
export const TRUST = { repository: "semics-uk/emdash-plugins", file: "release.yml", environment: "npm-publish" };

export const BOOTSTRAP_VERSION = "0.0.0-bootstrap.0";
const DEPRECATION =
	"Placeholder used only to set up trusted publishing; it contains no code. Install @rc or a later version.";

export function npmAtLeast(version, min) {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
	if (!m) return false;
	const v = m.slice(1).map(Number);
	for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
	return true;
}

/** An empty package that only claims the name: no code, no entry points, no dependencies. */
export function placeholderManifest(pkg) {
	return {
		name: pkg.name,
		version: BOOTSTRAP_VERSION,
		description: `Placeholder for ${pkg.name}, published once so npm trusted publishing can be configured. No code.`,
		license: pkg.license,
		repository: pkg.repository,
	};
}

/**
 * The commands for one package, in order. `exists`: already on npm, so no publish. `placeholder`: the
 * bootstrap placeholder is among its versions (a run stopped half way), so it still gets deprecated.
 */
export function bootstrapCommands(name, { dir, access, exists = false, placeholder = false, trust = TRUST }) {
	const trustCmd = [
		"npm",
		"trust",
		"github",
		name,
		"--file",
		trust.file,
		"--repository",
		trust.repository,
		"--environment",
		trust.environment,
		"--allow-publish",
		"--yes",
	];
	const deprecateCmd = ["npm", "deprecate", `${name}@${BOOTSTRAP_VERSION}`, DEPRECATION];
	if (exists) return placeholder ? [deprecateCmd, trustCmd] : [trustCmd];
	return [["npm", "publish", dir, "--access", access, "--tag", "bootstrap"], deprecateCmd, trustCmd];
}

function npm(args, opts = {}) {
	return spawnSync("npm", args, { encoding: "utf8", ...opts });
}

function npmVersion() {
	return npm(["--version"]).stdout ?? "";
}

/** The versions npm shows for a package, or null when it is not on npm. */
function registryVersions(name) {
	const result = npm(["view", name, "versions", "--json"]);
	if (result.status !== 0) return null;
	try {
		return [JSON.parse(result.stdout)].flat();
	} catch {
		return [];
	}
}

/** npm takes a while to show a fresh publish; deprecate and trust fail with 404 until it does. */
export function waitForVersion(name, version, { versions = registryVersions, sleep = sleepMs, tries = 30 } = {}) {
	for (let i = 0; i < tries; i++) {
		if ((versions(name) ?? []).includes(version)) return true;
		if (i < tries - 1) sleep(10_000);
	}
	return false;
}

function sleepMs(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function main(argv = process.argv.slice(2)) {
	const [command] = argv;
	if (command === "check-npm") {
		const version = npmVersion().trim();
		if (!npmAtLeast(version, MIN_NPM_PUBLISH)) {
			console.error(
				`npm ${version || "(not found)"} cannot publish by trusted publishing: need >= ${MIN_NPM_PUBLISH.join(".")}`,
			);
			return 1;
		}
		console.log(`npm ${version}: trusted publishing supported`);
		return 0;
	}
	if (command !== "bootstrap") {
		console.error("usage: npm-trust.mjs check-npm | bootstrap [--publish]");
		return 2;
	}
	const publish = argv.includes("--publish");
	if (publish) {
		const version = npmVersion().trim();
		if (!npmAtLeast(version, MIN_NPM_TRUST)) {
			console.error(`npm ${version} has no \`npm trust\`: run npm install -g npm@^${MIN_NPM_TRUST.join(".")}`);
			return 1;
		}
		if (npm(["whoami"]).status !== 0) {
			console.error("not logged in: run `npm login` first (an account with 2FA that owns the @semics-tech org)");
			return 1;
		}
	}
	const scratch = mkdtempSync(join(tmpdir(), "npm-trust-"));
	try {
		for (const { name, pkg } of publishablePackages()) {
			const dir = join(scratch, name.replace(/[@/]/g, "_"));
			const versions = publish ? registryVersions(name) : null;
			const exists = versions !== null;
			const placeholder = exists && versions.includes(BOOTSTRAP_VERSION);
			const commands = bootstrapCommands(name, { dir, access: "public", exists, placeholder });
			console.log(`${name}${exists ? " (already on npm: trust only)" : ""}`);
			for (const cmd of commands) {
				const shown = cmd.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
				console.log(`  $ ${shown}`);
				if (!publish) continue;
				if (cmd[1] === "publish") {
					mkdirSync(dir, { recursive: true });
					writeFileSync(join(dir, "package.json"), `${JSON.stringify(placeholderManifest(pkg), null, "\t")}\n`);
					writeFileSync(join(dir, "README.md"), `# ${name}\n\nPlaceholder; no code. See ${pkg.repository?.url}.\n`);
				}
				if (npm(cmd.slice(1), { stdio: "inherit" }).status !== 0) {
					console.error(`failed: ${shown}`);
					return 1;
				}
				if (cmd[1] === "publish" && !waitForVersion(name, BOOTSTRAP_VERSION)) {
					console.error(`${name}@${BOOTSTRAP_VERSION} is still not visible on npm after 5 minutes: re-run later`);
					return 1;
				}
			}
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
	console.log(
		publish
			? "done: merge to main within 2 days so each new trusted publisher sees its first publish"
			: "plan only, nothing changed: re-run with --publish after `npm login`",
	);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
