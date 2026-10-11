import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const biomeBin = join(repoRoot, "node_modules", ".bin", "biome");
const vitestBin = join(repoRoot, "packages", "esign", "node_modules", ".bin", "vitest");
const scratch = [];

after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway project whose Biome config extends the repo's real config. */
function fixtureProject(files, parent = tmpdir()) {
	const dir = mkdtempSync(join(parent, ".gate-fixture-"));
	scratch.push(dir);
	writeFileSync(join(dir, "biome.json"), JSON.stringify({ root: true, extends: [join(repoRoot, "biome.json")] }));
	for (const [name, body] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, name)), { recursive: true });
		writeFileSync(join(dir, name), body);
	}
	return dir;
}

const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: "utf8" });

const UNUSED_IMPORT = `import { readFileSync } from "node:fs";\n\nexport const answer = 42;\n`;

const VITEST_CONFIG = `import { defineConfig } from "vitest/config";
import { coverageConfig } from ${JSON.stringify(join(repoRoot, "vitest.coverage.mjs"))};
export default defineConfig({ test: { coverage: coverageConfig() } });
`;

/** Vitest fixture dirs sit under scripts/ so vitest resolves from a real node_modules (symlinked in). */
function vitestFixture(files) {
	const dir = fixtureProject({ "vitest.config.mjs": VITEST_CONFIG, ...files }, here);
	symlinkSync(join(repoRoot, "packages", "esign", "node_modules"), join(dir, "node_modules"));
	return dir;
}

test("Biome config rejects an unused import in a fixture file", () => {
	const dir = fixtureProject({ "src/unused.ts": UNUSED_IMPORT });
	const result = run(biomeBin, ["lint", "."], dir);
	assert.notEqual(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout + result.stderr, /noUnusedImports/);
});

test("running verify on a deliberately broken fixture exits non-zero", () => {
	const dir = fixtureProject({ "src/unused.ts": UNUSED_IMPORT });
	const result = run(process.execPath, [join(here, "verify.mjs"), "--root", dir], repoRoot);
	assert.notEqual(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout + result.stderr, /verify failed/i);
});

test("the repo root and every package expose a verify script", () => {
	for (const pkg of ["package.json", "packages/events/package.json", "packages/esign/package.json"]) {
		const json = JSON.parse(readFileSync(join(repoRoot, pkg), "utf8"));
		assert.ok(json.scripts?.verify, `${pkg} has no verify script`);
	}
});

test("coverage thresholds fail the run when a fixture module is below 90% lines", () => {
	const dir = vitestFixture({
		"src/domain/pricing.ts": `export function price(n: number): number {
	if (n < 0) {
		throw new Error("negative");
	}
	if (n === 0) {
		return 0;
	}
	if (n > 1000) {
		return 1000;
	}
	return n;
}
`,
		"src/domain/pricing.test.ts": `import { expect, test } from "vitest";
import { price } from "./pricing";
test("price", () => {
	expect(price(5)).toBe(5);
});
`,
	});
	const result = run(vitestBin, ["run", "--coverage"], dir);
	const out = result.stdout + result.stderr;
	assert.notEqual(result.status, 0, out);
	assert.match(out, /threshold/i);
});

test("coverage thresholds pass when the domain module is covered, and ignore code outside the globs", () => {
	const dir = vitestFixture({
		"src/domain/id.ts": "export const id = (n: number): number => n;\n",
		"src/domain/id.test.ts": `import { expect, test } from "vitest";
import { id } from "./id";
test("id", () => {
	expect(id(1)).toBe(1);
});
`,
		"src/other.ts": "export const unused = (n: number): number => n + 1;\n",
	});
	const result = run(vitestBin, ["run", "--coverage"], dir);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("coverage thresholds do not fail when no file matches the domain globs yet", () => {
	const dir = vitestFixture({
		"src/plain.ts": "export const plain = (n: number): number => n;\n",
		"src/plain.test.ts": `import { expect, test } from "vitest";
import { plain } from "./plain";
test("plain", () => {
	expect(plain(1)).toBe(1);
});
`,
	});
	const result = run(vitestBin, ["run", "--coverage"], dir);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a gate whose command cannot be launched fails loudly and names the command", async () => {
	const { verify } = await import("./verify.mjs");
	const errors = [];
	const original = console.error;
	const originalLog = console.log;
	console.error = (...args) => errors.push(args.join(" "));
	console.log = () => {};
	try {
		const status = verify(repoRoot, [{ name: "Missing tool", cmd: "semics-no-such-command", args: [], cwd: repoRoot }]);
		assert.notEqual(status, 0);
	} finally {
		console.error = original;
		console.log = originalLog;
	}
	assert.match(errors.join("\n"), /could not start "semics-no-such-command"/);
});
