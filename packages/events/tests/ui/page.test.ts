import { describe, expect, it } from "vitest";

import { checkPageOptions, eventPageHref, PAGE_CSS, pageCss } from "../../src/astro/lib/page";

// The plugins' own full pages (`/booking`, `/_events/waiver`): a default look, and what a site can set.

describe("page styles", () => {
	it("has a look of its own with no site theme", () => {
		expect(PAGE_CSS).toContain("body.semics-page");
		expect(pageCss()).toBe(PAGE_CSS);
	});

	it("is built on the promised custom properties, so a site's theme reaches every rule", () => {
		for (const property of ["--events-fg", "--events-bg", "--events-accent", "--events-font", "--events-radius"]) {
			expect(PAGE_CSS).toContain(`var(${property}`);
		}
		const themed = pageCss({ theme: { accent: "#1f3a2e", "page-bg": "#f6f1ea" } });
		expect(themed.startsWith(PAGE_CSS)).toBe(true);
		expect(themed).toContain(":root{--events-accent:#1f3a2e;--events-page-bg:#f6f1ea}");
	});

	it("passes the theme on to the signing form's own properties", () => {
		expect(PAGE_CSS).toContain("--esign-accent:var(--events-accent, #0b57d0)");
		expect(PAGE_CSS).toContain("--esign-fg:var(--events-fg, #1a1a1a)");
		expect(PAGE_CSS).toContain("--esign-font:var(--events-font, system-ui, sans-serif)");
	});

	it("names no physical side (right to left pages mirror)", () => {
		expect(PAGE_CSS).not.toMatch(/\b(left|right)\b/);
	});
});

describe("page options", () => {
	it("accepts a site's values and returns them", () => {
		const page = {
			theme: { accent: "#1f3a2e", font: '"Inter Variable", system-ui, sans-serif', radius: "8px" },
			stylesheet: "/events-theme.css",
			brand: { name: "Lea Marston Shooting Club", logo: "/brand/logo-forest.png", href: "/" },
			eventPath: "/activities/{slug}",
		};
		expect(checkPageOptions(page)).toBe(page);
		expect(checkPageOptions()).toEqual({});
	});

	it("stops a value that could break out of the stylesheet, or load from elsewhere", () => {
		for (const accent of ["red;}body{display:none", "</style><script>", "url(https://x.example/a)", "red\\9", ""]) {
			expect(() => checkPageOptions({ theme: { accent } })).toThrow("theme.accent");
		}
		expect(() => checkPageOptions({ theme: { nope: "red" } as never })).toThrow("theme.nope");
		expect(() => checkPageOptions({ stylesheet: "https://x.example/a.css" })).toThrow("stylesheet");
		expect(() => checkPageOptions({ stylesheet: "//x.example/a.css" })).toThrow("stylesheet");
		expect(() => checkPageOptions({ stylesheet: "/a.css; script-src *" })).toThrow("stylesheet");
		expect(() => checkPageOptions({ stylesheet: "/a.css;script-src" })).toThrow("stylesheet");
		expect(() => checkPageOptions({ stylesheet: "/a.css,/b.css" })).toThrow("stylesheet");
		expect(() => checkPageOptions({ brand: { name: "" } })).toThrow("brand.name");
		expect(() => checkPageOptions({ brand: { name: "A", logo: "javascript:x" } })).toThrow("brand.logo");
		expect(() => checkPageOptions({ brand: { name: "A", href: "//x.example" } })).toThrow("brand.href");
		expect(() => checkPageOptions({ eventPath: "/activities" })).toThrow("eventPath");
	});
});

describe("book again link", () => {
	it("goes to the site's event page, default /events/<slug>", () => {
		expect(eventPageHref("clay-shooting")).toBe("/events/clay-shooting");
		expect(eventPageHref("clay shooting", "/activities/{slug}")).toBe("/activities/clay%20shooting");
		expect(eventPageHref(undefined)).toBeUndefined();
		expect(eventPageHref(null, "/activities/{slug}")).toBeUndefined();
	});
});
