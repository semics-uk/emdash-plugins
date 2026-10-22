import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createPlugin, esignUi } from "../../src/ui/index";

const root = resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
	exports: Record<string, unknown>;
	files: string[];
	scripts: Record<string, string>;
};

describe("esign package entries (SU-FR-01)", () => {
	it("exports ./ui, ./astro, ./client and ./integration beside the core", () => {
		for (const key of [".", "./sandbox", "./ui", "./astro", "./client", "./integration"]) {
			expect(pkg.exports, key).toHaveProperty([key]);
		}
		expect(pkg.files).toEqual(expect.arrayContaining(["dist", "src/astro", "src/client"]));
		expect(pkg.scripts.build).toContain("tsconfig.ui.json");
	});

	it("the UI descriptor is a native plugin with its own id, apart from the core's", () => {
		const d = esignUi();
		expect(d.entrypoint).toBe("@semics-tech/emdash-esign/ui");
		expect(d.componentsEntry).toBe("@semics-tech/emdash-esign/astro");
		expect(d.id).not.toBe("semics-esign");
		expect(createPlugin().id).toBe(d.id);
	});

	it("the injected pages set the no-referrer and no-store headers and never render HTML from data", () => {
		const sign = readFileSync(resolve(root, "src/astro/SignPage.astro"), "utf8");
		const verify = readFileSync(resolve(root, "src/astro/VerifyPage.astro"), "utf8");
		for (const page of [sign, verify]) {
			expect(page).toContain('"Referrer-Policy", "no-referrer"');
			expect(page).toContain('"Cache-Control", "private, no-store"');
			expect(page).toContain('<meta name="referrer" content="no-referrer"');
			expect(page).not.toMatch(/set:html|innerHTML/);
		}
	});

	it("T034 the pages that take form posts refuse cross-site ones before reading the form (CSRF)", () => {
		for (const page of ["SignPage.astro", "VerifyPage.astro"]) {
			const source = readFileSync(resolve(root, "src/astro", page), "utf8");
			const check = source.indexOf("isCrossSiteRequest(Astro.request, Astro.url)");
			expect(check, page).toBeGreaterThan(-1);
			expect(check, page).toBeLessThan(source.indexOf("Astro.request.formData()"));
			expect(source, page).toContain("crossSiteResponse()");
		}
	});

	it("T034 the pages hand Astro.request to the helpers, so the core sees the visitor's IP and user agent", () => {
		for (const page of ["SignPage.astro", "SignedCopyPage.astro", "VerifyPage.astro"]) {
			const source = readFileSync(resolve(root, "src/astro", page), "utf8");
			expect(source, page).toContain("request: Astro.request");
		}
	});
});
