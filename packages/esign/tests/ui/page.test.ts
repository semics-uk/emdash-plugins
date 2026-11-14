import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { VERIFY_CSS, VERIFY_SCRIPT } from "../../src/astro/lib/assets";
import { cspSource, verifyCsp } from "../../src/astro/lib/csp";
import { checkEsignPage, DOCUMENT_START, ESIGN_PAGE_CSS, esignPageCss, pageView } from "../../src/astro/lib/page";

// T169: /sign/[token], /signed/[token] and /verify ran with no theme at all (the browser's Times New Roman and
// blue links). They now take the site's look from `esignIntegration({ page })`: one exact inline sheet allowed by
// its hash, an optional linked stylesheet, and the site's name or logo.

const src = (file: string) => readFileSync(resolve(import.meta.dirname, "../../src/astro", file), "utf8");

describe("T169 the pages' stylesheet", () => {
	it("T169 with no options, e-sign's own sheet: the system font, and links in the accent", () => {
		expect(esignPageCss()).toBe(ESIGN_PAGE_CSS);
		expect(ESIGN_PAGE_CSS).toContain("font-family:var(--esign-font, system-ui, sans-serif)");
		expect(ESIGN_PAGE_CSS).toContain("a{color:var(--esign-accent, #0b57d0)");
	});

	it("T169 a theme sets e-sign's custom properties after the defaults", () => {
		expect(esignPageCss({ theme: { accent: "#1f3a2e", "page-bg": "#f6f1ea" } })).toBe(
			`${ESIGN_PAGE_CSS}:root{--esign-accent:#1f3a2e;--esign-page-bg:#f6f1ea}\n`,
		);
	});

	it("T169 a whole sheet (the events suite's) replaces e-sign's own and its theme", () => {
		expect(esignPageCss({ css: "body{color:red}", theme: { accent: "#000" } })).toBe("body{color:red}");
	});

	it("T169 the linked stylesheet is made absolute for the CSP; the brand passes through", () => {
		const brand = { name: "Club", logo: "/logo.png" };
		expect(pageView({ stylesheet: "/theme.css", brand }, new URL("https://site.example/sign/x"))).toEqual({
			css: ESIGN_PAGE_CSS,
			stylesheet: "https://site.example/theme.css",
			brand,
		});
		expect(pageView({}, new URL("https://site.example/verify")).stylesheet).toBeUndefined();
	});
});

describe("T169 checking the options when the site's config loads", () => {
	it("T169 accepts a site's usual options", () => {
		const page = {
			theme: { accent: "#1f3a2e", font: 'system-ui, "Segoe UI", sans-serif' },
			stylesheet: "/brand/site.css",
			brand: { name: "Club", href: "/", logo: "/brand/logo.png", address: "1 High Street, Town" },
			css: "body{margin:0}",
		};
		expect(checkEsignPage(page)).toBe(page);
		expect(checkEsignPage()).toEqual({});
	});

	it.each([
		[{ theme: { accent: "red;}body{display:none" } }, "theme.accent"],
		[{ theme: { accent: "url(https://evil.example/x)" } }, "theme.accent"],
		[{ theme: { colour: "red" } }, "theme.colour"],
		[{ css: "</style><script>alert(1)</script>" }, "css"],
		[{ stylesheet: "https://evil.example/x.css" }, "stylesheet"],
		[{ stylesheet: "//evil.example/x.css" }, "stylesheet"],
		[{ stylesheet: "/a.css; script-src *" }, "stylesheet"],
		[{ brand: { name: " " } }, "brand.name"],
		[{ brand: { name: "Club", href: "https://evil.example" } }, "brand.href"],
		[{ brand: { name: "Club", logo: "javascript:alert(1)" } }, "brand.logo"],
		[{ brand: { name: "Club", address: "line\nbreak" } }, "brand.address"],
	])("T169 refuses %j", (page, what) => {
		expect(() => checkEsignPage(page as never)).toThrow(`page.${what} is not valid`);
	});
});

describe("T169 the verify page's CSP allows the page sheet", () => {
	it("T169 without extras it is unchanged", async () => {
		const header = await verifyCsp();
		expect(header).toContain(`style-src ${await cspSource(VERIFY_CSS)};`);
		expect(header).toContain(`script-src ${await cspSource(VERIFY_SCRIPT)};`);
		expect(header).not.toContain("img-src");
	});

	it("T169 with the page's sheet, a stylesheet and a logo: each by its hash or exact URL", async () => {
		const header = await verifyCsp({ styles: ["a{}"], stylesheet: "https://site.example/theme.css" });
		expect(header).toContain(
			`style-src ${await cspSource(VERIFY_CSS)} ${await cspSource("a{}")} https://site.example/theme.css;`,
		);
		expect(header).toContain("img-src 'self'");
		expect(header).toContain("font-src 'self'");
		expect(header).toContain(`script-src ${await cspSource(VERIFY_SCRIPT)};`);
		expect(header).not.toMatch(/unsafe-inline/);
	});
});

describe("T169 the pages render the site's look", () => {
	const layout = src("EsignPage.astro");

	it.each(["SignPage.astro", "SignedCopyPage.astro", "VerifyPage.astro"])("T169 %s uses the themed layout", (file) => {
		const page = src(file);
		expect(page).toContain("<EsignPage");
		expect(page).toContain("pageView(page, Astro.url)");
		expect(page).not.toContain("<!doctype html>");
	});

	it("T169 the sign and signed-copy pages allow the sheet in the ceremony CSP; /verify in its own", () => {
		for (const file of ["SignPage.astro", "SignedCopyPage.astro"]) {
			expect(src(file)).toContain("ceremonyCsp({ styles: [look.css], stylesheet: look.stylesheet })");
		}
		expect(src("VerifyPage.astro")).toContain("verifyCsp({ styles: [look.css], stylesheet: look.stylesheet })");
	});

	it("T169 the layout inlines the sheet, links the stylesheet, and shows the brand at the top and foot", () => {
		expect(layout).toContain("<style is:inline set:html={css}></style>");
		expect(layout).toContain('<link rel="stylesheet" href={stylesheet} />');
		expect(layout).toContain('<body class="semics-page">');
		expect(layout).toContain('<header class="semics-page-brand">');
		expect(layout).toContain('<footer class="semics-page-organiser"');
	});

	it("T169 EmDash's editor toolbar stays off: the document starts with a comment, then the doctype, in one chunk", () => {
		// Astro drops a literal doctype and prefixes its own unless the first chunk names one: one set:html string.
		expect(DOCUMENT_START).toMatch(/^<!--[^>]*--><!doctype html>$/);
		const markup = layout.slice(layout.indexOf("---", 3) + 3).trimStart();
		expect(markup.startsWith("<Fragment set:html={DOCUMENT_START} />")).toBe(true);
	});
});
