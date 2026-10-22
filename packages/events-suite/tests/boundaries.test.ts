import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The suite only wires the two products together (tasks/README.md module boundaries): no business
// rules, no core internals, no private shared library (R35), and never a hard-coded plugin id (S7).

const root = resolve(import.meta.dirname, "..");

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path);
		return /\.(ts|js|mjs|astro)$/.test(entry.name) ? [path] : [];
	});
}

const sources = files(join(root, "src")).map((path) => ({
	path: relative(root, path),
	text: readFileSync(path, "utf8"),
}));

/** Every module specifier a source imports or re-exports. */
const imports = (text: string) =>
	[...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1] as string);

describe("suite boundaries (SX-FR-01, SX-FR-02)", () => {
	it("SX-FR-01 has sources to check", () => {
		expect(sources.length).toBeGreaterThan(3);
	});

	it("SX-FR-01 never hard-codes a core's plugin id", () => {
		const offenders = sources.filter(({ text }) => /["'`](semics-events|semics-esign)["'`]/.test(text));
		expect(offenders.map((s) => s.path)).toEqual([]);
	});

	it("SX-FR-02 imports only the products' public entry points, never a core's internals", () => {
		const allowed =
			/^(\.{1,2}\/|emdash($|\/)|virtual:semics-events-suite\/config$|@semics-tech\/emdash-(events|esign)(\/(ui|integration|astro(\/lib\/[a-z-]+|\/[A-Za-z]+\.astro)?))?$)/;
		const offenders = sources.flatMap(({ path, text }) =>
			imports(text)
				.filter((spec) => !allowed.test(spec))
				.map((spec) => `${path}: ${spec}`),
		);
		expect(offenders).toEqual([]);
	});

	it("SX-FR-02 holds no booking or signing rules: no storage, no tokens minted, no HMAC", () => {
		const rules = /ctx\.storage|crypto\.subtle\.(sign|importKey)|createHmac|updateIf|esign-intent\/1\./;
		expect(sources.filter(({ text }) => rules.test(text)).map((s) => s.path)).toEqual([]);
	});
});
