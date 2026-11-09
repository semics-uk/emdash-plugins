import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createPlugin } from "../../src/ui/index";

const root = resolve(import.meta.dirname, "../..");

describe("the esign-request block ships as source (SU-FR-12)", () => {
	it("the UI plugin declares the esign-request editor block and the Astro entry renders it", () => {
		const blocks = (createPlugin() as { admin?: { portableTextBlocks?: Array<{ type: string }> } }).admin
			?.portableTextBlocks;
		expect(blocks?.map((b) => b.type)).toEqual(["esign-request"]);
		expect(readFileSync(resolve(root, "src/astro/index.js"), "utf8")).toMatch(/"esign-request":\s*SelfServeBlock/);
	});

	it("the block has a honeypot, a Turnstile widget slot and renders nothing from data as HTML", () => {
		const block = readFileSync(resolve(root, "src/astro/SelfServeBlock.astro"), "utf8");
		expect(block).toContain('name="website"');
		expect(block).toContain("cf-turnstile");
		expect(block).not.toMatch(/set:html|innerHTML/);
		expect(block).not.toContain("@semics-tech/shared");
	});

	// T159: the same Turnstile sizing as the booking widgets (T158). The old script read the empty box's own width
	// before layout (0 px), which picked compact on a desktop; and the box had no theme (dark on a light form).
	describe("T159 the Turnstile box", () => {
		const block = readFileSync(resolve(root, "src/astro/SelfServeBlock.astro"), "utf8");
		const script =
			/<div class="cf-turnstile"[^>]*\/?>(?:<\/div>)?\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<script is:inline>([\s\S]*?)<\/script>/.exec(
				block,
			)?.[1];

		/** Runs the inline script with a box `box` px wide inside a form `form` px wide (null: no form) on a `screen` px screen. */
		function size(box: number, form: number | null, screen: number): string | undefined {
			const attrs: Record<string, string> = {};
			const t = {
				clientWidth: box,
				closest: (sel: string) => (sel === "form" && form !== null ? { clientWidth: form } : null),
				setAttribute: (k: string, v: string) => {
					attrs[k] = v;
				},
			};
			const document = { currentScript: { previousElementSibling: t }, documentElement: { clientWidth: screen } };
			new Function("document", script as string)(document);
			return attrs["data-size"];
		}

		it("T159 is light, like the form", () => {
			expect(block).toMatch(/<div class="cf-turnstile" data-sitekey=\{view\.turnstileSiteKey\} data-theme="light"/);
		});

		it("T159 measures the form, not the empty box: full size on a desktop even before layout", () => {
			expect(script).toBeTruthy();
			expect(size(0, 640, 1280)).toBeUndefined();
			expect(size(0, 0, 1280)).toBeUndefined();
			expect(size(0, null, 1280)).toBeUndefined();
		});

		it("T159 compact only when the form (or the screen less 48 px) is under 300 px", () => {
			expect(size(0, 272, 320)).toBe("compact");
			expect(size(0, 0, 320)).toBe("compact");
			expect(size(0, 300, 375)).toBeUndefined();
			expect(size(0, 0, 340)).toBe("compact");
			expect(size(0, 0, 375)).toBeUndefined();
		});

		it("T159 is the booking widgets' script, character for character", () => {
			const widget = readFileSync(resolve(root, "../events/src/astro/BookingWidget.astro"), "utf8");
			const theirs =
				/<div class="cf-turnstile"[^>]*><\/div>\s*\{\/\*[\s\S]*?\*\/\}\s*<script is:inline>([\s\S]*?)<\/script>/.exec(
					widget,
				)?.[1];
			expect(theirs).toBeTruthy();
			expect(script).toBe(theirs);
		});
	});

	it("the endpoint is exported by the package", () => {
		const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { exports: Record<string, unknown> };
		expect(pkg.exports).toHaveProperty(["./astro/self-serve-endpoint"]);
		expect(pkg.exports).toHaveProperty(["./astro/SelfServeBlock.astro"]);
	});
});
