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

describe("events UI client budget and escaping (EU-NFR-02, T055 escaping)", () => {
	it("EU-NFR-02 the booking client script is self-contained and at most 15 KB gzipped", () => {
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

	it("EV-FR-17 the day-then-time picker's script is self-contained, small, and has no HTML sinks (T130)", () => {
		const source = readFileSync(resolve(root, "src/client/picker.ts"), "utf8");
		expect(source).not.toMatch(/^\s*import\s/m);
		expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
		const js = ts.transpileModule(source, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true },
		}).outputText;
		expect(gzipSync(js).length).toBeLessThanOrEqual(3 * 1024);
		const widget = readFileSync(resolve(root, "src/astro/BookingWidget.astro"), "utf8");
		expect(widget).toContain("../client/picker.ts");
	});

	it("EV-FR-11 the check-in screen's script is self-contained, small, and has no HTML sinks (T082)", () => {
		const source = readFileSync(resolve(root, "src/client/checkin.ts"), "utf8");
		expect(source).not.toMatch(/^\s*import\s/m);
		expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
		const js = ts.transpileModule(source, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true },
		}).outputText;
		expect(gzipSync(js).length).toBeLessThanOrEqual(4 * 1024);
	});

	it("EV-FR-11 the check-in page is server-rendered, noindex, and passes draw their QR as SVG (T082)", () => {
		const page = readFileSync(resolve(root, "src/astro/CheckIn.astro"), "utf8");
		expect(page).toContain('name="robots" content="noindex"');
		expect(page).toContain("Referrer-Policy");
		expect(page).toContain("../client/checkin.ts");
		expect(page).toMatch(/<form[^>]*data-semics-checkin/);
		const pass = readFileSync(resolve(root, "src/astro/TicketPass.astro"), "utf8");
		expect(pass).toContain("qrPath(");
		expect(pass).toContain("<svg");
		expect(readFileSync(resolve(root, "src/astro/BookingPage.astro"), "utf8")).toMatch(/<TicketPass[^>]*qr=\{/);
		expect(readFileSync(resolve(root, "package.json"), "utf8")).toContain('"./astro/CheckIn.astro"');
	});

	it("never renders user content as HTML: no set:html in components, no HTML sinks in the client", () => {
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
