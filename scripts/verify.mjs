#!/usr/bin/env node
// `pnpm verify`: every quality gate, cheapest first, stopping at the first failure.
//
//   node scripts/verify.mjs [--root <dir>]
//
// --root points the Biome gate (and the later steps) at another directory; the tests use it to
// prove that a deliberately broken project makes verify exit non-zero.

import { spawnSync } from "node:child_process";
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

export function verify(root, stepList = steps(root)) {
	for (const step of stepList) {
		console.log(`\n== ${step.name}`);
		if (step.skip) {
			console.log(`skipped (${step.skip})`);
			continue;
		}
		const result = spawnSync(step.cmd, step.args, { cwd: step.cwd, stdio: "inherit" });
		if (result.error) {
			console.error(
				`\nverify failed at: ${step.name}: could not start "${step.cmd}" (${result.error.code ?? result.error.message}). Is it on PATH?`,
			);
			return 1;
		}
		if (result.status !== 0) {
			console.error(`\nverify failed at: ${step.name}`);
			return result.status || 1;
		}
	}
	console.log("\nverify passed");
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(verify(parseRoot(process.argv.slice(2))));
}
