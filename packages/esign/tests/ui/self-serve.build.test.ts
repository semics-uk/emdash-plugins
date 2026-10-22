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

	it("the endpoint is exported by the package", () => {
		const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { exports: Record<string, unknown> };
		expect(pkg.exports).toHaveProperty(["./astro/self-serve-endpoint"]);
		expect(pkg.exports).toHaveProperty(["./astro/SelfServeBlock.astro"]);
	});
});
