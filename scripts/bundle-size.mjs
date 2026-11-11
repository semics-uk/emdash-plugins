#!/usr/bin/env node
// Backend bundle sizes, as Markdown for a CI job summary (T162).
//
//   node scripts/bundle-size.mjs            after a build (`pnpm verify` builds every package)
//
// Lists each package's built `dist/plugin.mjs` (the registry's `backend.js`, byte-identical) with its
// room under the registry's 128 KiB per-file cap, and for Free Events its room under the 125 KiB
// budget less the 4 KiB hotfix room (R94, R100; `packages/shared/testing/bundle-size.ts` is the
// enforced copy, `packages/events/tests/bundle-size.build.test.ts` the gate). CI appends this to every
// run's summary, pull requests and pushes to main alike, so a PR's size compares with main's latest run.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTRY_FILE_LIMIT = 128 * 1024;
export const EVENTS_BUNDLE_BUDGET = REGISTRY_FILE_LIMIT - 3 * 1024;
export const EVENTS_HOTFIX_ROOM = 4 * 1024;

const kb = (n) => n.toLocaleString("en-GB");

/** Markdown for `rows` (`{ name, bytes }`): bytes, room under the registry cap, Events' room under its budget. */
export function report(rows) {
	const lines = [
		"### Backend bundle size",
		"",
		"| Package | `plugin.mjs` bytes | Under the 128 KiB cap | Under budget less hotfix room |",
		"|---|---:|---:|---:|",
	];
	for (const { name, bytes } of rows) {
		const events = name === "events";
		const room = events ? kb(EVENTS_BUNDLE_BUDGET - EVENTS_HOTFIX_ROOM - bytes) : "";
		lines.push(`| ${name} | ${kb(bytes)} | ${kb(REGISTRY_FILE_LIMIT - bytes)} | ${room} |`);
	}
	if (rows.length === 0) lines.push("| (nothing built) | | | |");
	return `${lines.join("\n")}\n`;
}

/** `{ name, bytes }` for every package under `root/packages` with a built `dist/plugin.mjs`. */
export function sizes(root) {
	const dir = join(root, "packages");
	return readdirSync(dir)
		.filter((name) => existsSync(join(dir, name, "dist", "plugin.mjs")))
		.sort()
		.map((name) => ({ name, bytes: statSync(join(dir, name, "dist", "plugin.mjs")).size }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.stdout.write(report(sizes(resolve(dirname(fileURLToPath(import.meta.url)), ".."))));
}
