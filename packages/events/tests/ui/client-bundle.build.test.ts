import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const CLIENT = resolve(root, "src/client/booking.ts");
/** EU-NFR-01: the booking widget's own client script, gzipped. Turnstile's script is Cloudflare's. */
const BUDGET_BYTES = 15 * 1024;

function files(dir: string, ext: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path, ext);
		return entry.name.endsWith(ext) ? [path] : [];
	});
}

describe("events UI client budget and escaping (EU-NFR-01, EU-NFR-05)", () => {
	it("EU-NFR-01 the booking client script is self-contained and at most 15 KB gzipped", () => {
		const source = readFileSync(CLIENT, "utf8");
		// No imports: what the transpiled file weighs is what the browser downloads.
		expect(source).not.toMatch(/^\s*import\s/m);
		const js = ts.transpileModule(source, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true },
		}).outputText;
		const gzipped = gzipSync(js).length;
		expect(gzipped).toBeGreaterThan(500);
		expect(gzipped).toBeLessThanOrEqual(BUDGET_BYTES);
	});

	it("EU-NFR-05 never renders user content as HTML: no set:html in components, no HTML sinks in the client", () => {
		const astro = files(resolve(root, "src/astro"), ".astro");
		expect(astro.length).toBeGreaterThanOrEqual(5);
		for (const file of astro) expect(readFileSync(file, "utf8"), file).not.toMatch(/set:html|innerHTML/);
		const client = readFileSync(CLIENT, "utf8");
		expect(client).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
	});

	it("EU-FR-04 the widget is a plain form post first, and says when it needs scripts for Turnstile", () => {
		const widget = readFileSync(resolve(root, "src/astro/BookingWidget.astro"), "utf8");
		expect(widget).toMatch(/<form[^>]*method="post"/);
		expect(widget).toContain("CHECKOUT_PATH");
		expect(widget).toContain("<noscript");
		expect(widget).toContain('name="idempotencyKey"');
	});
});
