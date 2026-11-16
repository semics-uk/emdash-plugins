#!/usr/bin/env node
// CI helpers for the Changesets version PR and for the "pnpm verify" aggregator job (ci.yml).
//
//   node scripts/version-pr.mjs scope [--base <ref>] [--head <ref>]   prints light=true|false
//   node scripts/version-pr.mjs lockstep                              fails unless each fixed group shares a version
//   node scripts/version-pr.mjs gates                                 reads NEEDS (toJSON(needs)) and LIGHT
//   node scripts/version-pr.mjs wait-ci                               waits for CI's "pnpm verify" on GITHUB_SHA
//
// `wait-ci` is release.yml's gate: nothing is published until CI's "pnpm verify" check run (the aggregator
// of every gate) has passed on the commit being released. It reads GITHUB_TOKEN, GITHUB_REPOSITORY and
// GITHUB_SHA, polls every 20 s and fails on any other conclusion.
//
// `scope` decides whether a pull request is the bot's "version packages" PR in substance: every changed file
// is under .changeset/, a CHANGELOG.md, or a package.json whose only change is its "version" field. Such a
// PR runs the light path (lint, board, script tests, changeset and lockstep checks) instead of the package
// suites, build and Playwright. ci.yml additionally requires the head branch to be changeset-release/main
// in this repository. Base and head default to HEAD^1 and HEAD: on a pull request's merge commit that is
// exactly what the PR would change on its base branch.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const withoutVersion = (text) => {
	const { version: _version, ...rest } = JSON.parse(text);
	return rest;
};

/**
 * @param {{ path: string, before: string | null, after: string | null }[]} changes `before`/`after` are the
 *   file's contents at base and head (null when absent); only package.json contents are read.
 * @returns {{ light: boolean, reason: string }}
 */
export function classify(changes) {
	if (changes.length === 0) return { light: false, reason: "no changed files" };
	for (const { path, before, after } of changes) {
		if (path.startsWith(".changeset/")) continue;
		if (basename(path) === "CHANGELOG.md") continue;
		if (basename(path) === "package.json") {
			if (before === null || after === null) return { light: false, reason: `${path} added or removed` };
			let same = false;
			try {
				same = isDeepStrictEqual(withoutVersion(before), withoutVersion(after));
			} catch {
				return { light: false, reason: `${path} is not valid JSON` };
			}
			if (same) continue;
			return { light: false, reason: `${path} changes more than its version` };
		}
		return { light: false, reason: `${path} is not a version, changelog or changeset file` };
	}
	return { light: true, reason: `${changes.length} version, changelog and changeset files only` };
}

/**
 * @param {{ fixed?: string[][] }} config the parsed .changeset/config.json
 * @param {Record<string, string>} versions package name to version
 * @returns {string[]} one message per fixed group whose versions differ
 */
export function lockstepProblems(config, versions) {
	const problems = [];
	for (const group of config.fixed ?? []) {
		const seen = new Set(group.map((name) => versions[name]));
		if (seen.size > 1 || seen.has(undefined)) {
			problems.push(`fixed group not in lockstep: ${group.map((name) => `${name}@${versions[name]}`).join(", ")}`);
		}
	}
	return problems;
}

/**
 * The "pnpm verify" aggregator: every gate job must succeed; on the light path the skipped heavy jobs are
 * fine, but the light gates (and the scope job itself) must still succeed.
 * @param {Record<string, { result: string }>} needs GitHub's `needs` context
 * @param {boolean} light
 * @param {string[]} lightJobs jobs that run on the light path too
 * @returns {string[]} one message per job that did not pass
 */
export function gateProblems(needs, light, lightJobs = ["scope", "gates"]) {
	const problems = [];
	for (const [job, { result }] of Object.entries(needs)) {
		if (result === "success") continue;
		if (light && result === "skipped" && !lightJobs.includes(job)) continue;
		problems.push(`${job}: ${result}`);
	}
	if (Object.keys(needs).length === 0) problems.push("no gate jobs to check");
	return problems;
}

export const CI_CHECK = "pnpm verify";

/**
 * @param {{ name: string, status: string, conclusion: string | null, started_at?: string }[]} checkRuns
 *   the commit's check runs (GitHub's REST shape)
 * @returns {"pass" | "fail" | "wait"} for the latest run named CI_CHECK; none yet means wait
 */
export function ciVerdict(checkRuns) {
	const runs = checkRuns
		.filter((run) => run.name === CI_CHECK)
		.sort((a, b) => String(a.started_at ?? "").localeCompare(String(b.started_at ?? "")));
	const latest = runs.at(-1);
	if (latest?.status !== "completed") return "wait";
	return latest.conclusion === "success" ? "pass" : "fail";
}

async function waitCi({ intervalMs = 20_000, attempts = 105 } = {}) {
	const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA } = process.env;
	if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_SHA) {
		console.error("version-pr: wait-ci needs GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA");
		return 1;
	}
	const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/check-runs?check_name=${encodeURIComponent(CI_CHECK)}&per_page=100`;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const response = await fetch(url, {
			headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
		});
		if (!response.ok) {
			console.error(`version-pr: check runs request failed (${response.status}); retrying`);
		} else {
			const verdict = ciVerdict((await response.json()).check_runs ?? []);
			if (verdict === "pass") {
				console.log(`version-pr: CI's "${CI_CHECK}" passed on ${GITHUB_SHA}`);
				return 0;
			}
			if (verdict === "fail") {
				console.error(
					`version-pr: CI's "${CI_CHECK}" did not pass on ${GITHUB_SHA}; not releasing. Re-run CI, then this workflow.`,
				);
				return 1;
			}
		}
		await new Promise((done) => setTimeout(done, intervalMs));
	}
	console.error(`version-pr: gave up waiting for CI's "${CI_CHECK}" on ${GITHUB_SHA}`);
	return 1;
}

function git(args) {
	const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	return result.status === 0 ? result.stdout : null;
}

function option(argv, name, fallback) {
	const i = argv.indexOf(name);
	return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}

function scope(argv) {
	const base = option(argv, "--base", "HEAD^1");
	const head = option(argv, "--head", "HEAD");
	const diff = git(["diff", "--name-only", "--no-renames", base, head]);
	if (diff === null) {
		console.error(`version-pr: cannot diff ${base}..${head}; running the full checks`);
		console.log("light=false");
		return 0;
	}
	const show = (ref, path) => (basename(path) === "package.json" ? git(["show", `${ref}:${path}`]) : "");
	const changes = diff
		.split("\n")
		.filter(Boolean)
		.map((path) => ({ path, before: show(base, path), after: show(head, path) }));
	const { light, reason } = classify(changes);
	console.error(`version-pr: ${light ? "light path" : "full checks"} (${reason})`);
	console.log(`light=${light}`);
	return 0;
}

function lockstep() {
	const config = JSON.parse(readFileSync(join(repoRoot, ".changeset", "config.json"), "utf8"));
	const versions = {};
	for (const dir of readdirSync(join(repoRoot, "packages"))) {
		const file = join(repoRoot, "packages", dir, "package.json");
		if (!existsSync(file)) continue;
		const json = JSON.parse(readFileSync(file, "utf8"));
		versions[json.name] = json.version;
	}
	const problems = lockstepProblems(config, versions);
	for (const problem of problems) console.error(`version-pr: ${problem}`);
	if (problems.length === 0) console.log("version-pr: every fixed group shares one version");
	return problems.length === 0 ? 0 : 1;
}

function gates() {
	const needs = JSON.parse(process.env.NEEDS ?? "{}");
	const light = process.env.LIGHT === "true";
	const problems = gateProblems(needs, light);
	for (const problem of problems) console.error(`version-pr: gate did not pass: ${problem}`);
	if (problems.length === 0) console.log(`version-pr: every gate passed${light ? " (version PR: light path)" : ""}`);
	return problems.length === 0 ? 0 : 1;
}

export async function run(argv) {
	const [command, ...rest] = argv;
	if (command === "wait-ci") return waitCi();
	if (command === "scope") return scope(rest);
	if (command === "lockstep") return lockstep();
	if (command === "gates") return gates();
	console.error("usage: version-pr.mjs scope|lockstep|gates|wait-ci");
	return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await run(process.argv.slice(2)));
}
