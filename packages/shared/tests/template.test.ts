import { describe, expect, it } from "vitest";
import {
	canonicalSnapshot,
	escapeValue,
	renderTemplate,
	sha256Hex,
	TemplateError,
	templateFields,
} from "../src/index";

describe("renderTemplate (ES-FR-01)", () => {
	it("fills placeholders, tolerating inner spaces and repeats", () => {
		const out = renderTemplate("Hi {{name}}, {{ name }} owes {{amount}}.", { name: "Ada", amount: 12 });
		expect(out).toBe("Hi Ada, Ada owes 12.");
	});

	it("ignores unused values and leaves text without placeholders alone", () => {
		expect(renderTemplate("plain", { x: "y" })).toBe("plain");
	});

	it("fails with a named error for a missing field", () => {
		try {
			renderTemplate("Hi {{ name }}", {});
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(TemplateError);
			expect((e as TemplateError).code).toBe("TEMPLATE_MISSING_FIELD");
			expect((e as TemplateError).field).toBe("name");
			expect((e as Error).message).toContain("name");
		}
	});

	it("does not treat inherited properties as fields", () => {
		expect(() => renderTemplate("{{toString}}", {})).toThrow(TemplateError);
	});

	it("lists the fields a template needs, once each", () => {
		expect(templateFields("{{a}} {{b.c}} {{a}}")).toEqual(["a", "b.c"]);
	});

	it("does not re-expand placeholders inside values", () => {
		expect(renderTemplate("{{a}}", { a: "{{b}}", b: "x" })).not.toContain("x");
	});
});

describe("value escaping (ES-FR-01)", () => {
	it("cannot inject HTML", () => {
		const out = renderTemplate("{{v}}", { v: `<script>alert("x")</script> & 'y'` });
		expect(out).not.toContain("<");
		expect(out).toContain("&lt;script&gt;");
		expect(out).toContain("&amp;");
		expect(out).toContain("&quot;");
		expect(out).toContain("&#39;");
	});

	it("cannot inject Markdown", () => {
		const out = renderTemplate("{{v}}", { v: "# H [l](http://x) **b** `c` _i_ ~s~ |t| > q" });
		expect(out).toBe("\\# H \\[l\\]\\(http://x\\) \\*\\*b\\*\\* \\`c\\` \\_i\\_ \\~s\\~ \\|t\\| &gt; q");
	});

	it("flattens newlines so a value cannot open a new block", () => {
		expect(escapeValue("a\n\n# b\r\nc")).toBe("a \\# b c");
	});

	it("escapes backslashes and braces", () => {
		expect(escapeValue("\\ {{x}}")).toBe("\\\\ \\{\\{x\\}\\}");
	});
});

describe("canonicalSnapshot (ES-FR-03)", () => {
	it("normalises line endings", () => {
		expect(canonicalSnapshot("a\r\nb\rc\nd")).toBe("a\nb\nc\nd\n");
	});

	it("normalises Unicode to NFC", () => {
		expect(canonicalSnapshot("é")).toBe("é\n");
	});

	it("strips BOM, trailing spaces and surplus trailing newlines", () => {
		expect(canonicalSnapshot("﻿a \t\nb  \n\n\n")).toBe("a\nb\n");
	});

	it("is idempotent", () => {
		const once = canonicalSnapshot("x\r\n y \r\n");
		expect(canonicalSnapshot(once)).toBe(once);
	});

	it("makes equal documents hash equally", async () => {
		const a = await sha256Hex(canonicalSnapshot("café\r\nline  \r\n"));
		const b = await sha256Hex(canonicalSnapshot("café\nline\n"));
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	it("hashes known vectors", async () => {
		expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});
});
