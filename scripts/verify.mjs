#!/usr/bin/env node
// `pnpm verify`: every quality gate, cheapest first, stopping at the first failure.
//
//   node scripts/verify.mjs [--root <dir>] [--verbose]
//
// Quiet by default: a passing gate prints one line; a failing gate prints its last 200 lines.
// Every gate's full output is written to .verify.log. --verbose streams output as it runs.
//
// --root points the Biome gate (and the later steps) at another directory; the tests use it to
// prove that a deliberately broken project makes verify exit non-zero.

import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentBranch } from "./changeset-check.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseRoot(argv) {
	const i = argv.indexOf("--root");
	return i === -1 ? repoRoot : resolve(argv[i + 1] ?? "");
}

export function steps(root) {
	const biome = join(repoRoot, "node_modules", ".bin", "biome");
	const pnpm = (...args) => ({ cmd: "pnpm", args });
	return [
		{ name: "Biome lint and format check", cmd: biome, args: ["ci", "."] },
		{ name: "Task board check", ...pnpm("run", "tasks:check") },
		{ name: "Script tests", ...pnpm("run", "test:scripts") },
		{
			name: "Changeset check",
			...pnpm("run", "changeset:check"),
			skip: currentBranch() === "main" ? "on main: nothing to compare against" : undefined,
		},
		{
			name: "Packages: validate, typecheck, tests with coverage, build",
			...pnpm("-r", "--filter", "./packages/**", "verify"),
		},
		{ name: "Playground typecheck", ...pnpm("--filter", "playground", "typecheck") },
	].map((step) => ({ ...step, cwd: root }));
}

const TAIL_LINES = 200;

export function verify(
	root,
	stepList = steps(root),
	{ verbose = false, logFile = join(repoRoot, ".verify.log") } = {},
) {
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
	process.exit(verify(parseRoot(process.argv.slice(2)), undefined, { verbose: process.argv.includes("--verbose") }));
}
