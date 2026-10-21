import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packagesDir = fileURLToPath(new URL("../..", import.meta.url));
const TESTING_IMPORT = /["'](?:@semics-tech\/shared\/testing|[./]*(?:shared\/)?testing\/budget(?:\.ts)?)["']/;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		if (name === "node_modules" || name === "dist") return [];
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.(?:[cm]?[jt]sx?|astro)$/.test(name) ? [path] : [];
	});
}

/** Runtime code of every package: each package's `src/` tree. Tests and fixtures are outside it. */
function runtimeFiles(): string[] {
	return readdirSync(packagesDir).flatMap((pkg) => {
		const src = join(packagesDir, pkg, "src");
		try {
			return statSync(src).isDirectory() ? sourceFiles(src) : [];
		} catch {
			return [];
		}
	});
}

// T007: the budget harness is test-only. It patches the Worker Loader binding, so it must never
// reach a sandbox bundle or a UI entry.
describe("@semics-tech/shared/testing boundary (T007)", () => {
	it("the import pattern recognises the ways the harness can be imported", () => {
		for (const spec of ['"@semics-tech/shared/testing"', '"../testing/budget"', "'../../shared/testing/budget.ts'"]) {
			expect(spec).toMatch(TESTING_IMPORT);
		}
		expect('"@semics-tech/shared"').not.toMatch(TESTING_IMPORT);
	});

	it("no package's runtime source imports the budget harness", () => {
		const files = runtimeFiles();
		expect(files.length).toBeGreaterThan(0);
		const offenders = files
			.filter((file) => TESTING_IMPORT.test(readFileSync(file, "utf8")))
			.map((file) => relative(packagesDir, file));
		expect(offenders).toEqual([]);
	});
});
