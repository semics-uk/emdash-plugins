import { escapeValue, renderTemplate } from "@semics-tech/shared";
import { describe, expect, it } from "vitest";

import { type Block, type Inline, parseSnapshot, safeHref, textOf } from "../../src/astro/lib/markdown";
import payloads from "./xss-payloads.json";

// T030 (SU-FR-03, SU-NFR-01): the snapshot is sender-written Markdown with escaped values
// (`renderTemplate`). It is parsed into a tree of a few allowed node kinds whose text is rendered
// only through Astro's escaping interpolation, so no markup in it can reach the page as markup.

const BLOCKS = new Set(["heading", "paragraph", "list", "quote", "code", "rule"]);
const INLINES = new Set(["text", "strong", "em", "code", "link", "break"]);

/** Every node in the tree, with its kind checked against the allowlist and every link checked. */
function walk(blocks: Block[], visit: (kind: string, node: Block | Inline) => void) {
	const inline = (nodes: Inline[]) => {
		for (const node of nodes) {
			visit(node.type, node);
			if ("children" in node) inline(node.children);
		}
	};
	for (const block of blocks) {
		visit(block.type, block);
		if (block.type === "quote") walk(block.children, visit);
		else if (block.type === "list") for (const item of block.items) inline(item);
		else if ("children" in block) inline(block.children);
	}
}

function linksOf(blocks: Block[]): string[] {
	const hrefs: string[] = [];
	walk(blocks, (_kind, node) => {
		if (node.type === "link") hrefs.push(node.href);
	});
	return hrefs;
}

describe("snapshot sanitiser: XSS payload suite (SU-NFR-01, ES-NFR-05)", () => {
	it(`has at least 40 payloads (${payloads.length})`, () => {
		expect(payloads.length).toBeGreaterThanOrEqual(40);
	});

	it.each(payloads.map((p, i) => [i, p] as const))(
		"SU-NFR-01 payload %i parses to allowed nodes only",
		(_i, payload) => {
			const blocks = parseSnapshot(`Before\n\n${payload}\n\nAfter`);
			walk(blocks, (kind, node) => {
				expect(BLOCKS.has(kind) || INLINES.has(kind), kind).toBe(true);
				// The tree has no place for attributes other than a link's checked href.
				const keys = Object.keys(node).filter(
					(k) => !["type", "children", "text", "items", "level", "ordered", "start", "href"].includes(k),
				);
				expect(keys).toEqual([]);
			});
			for (const href of linksOf(blocks)) expect(href).toMatch(/^(https?:\/\/|mailto:)/);
			const text = textOf(blocks);
			expect(text).toContain("Before");
			expect(text).toContain("After");
		},
	);

	it("SU-NFR-01 a payload inside an escaped value comes back as exactly the value's text", () => {
		for (const payload of payloads) {
			const snapshot = renderTemplate("Name: {{name}}", { name: payload });
			const text = textOf(parseSnapshot(snapshot));
			expect(text).toBe(`Name: ${payload.replace(/\s*[\r\n]+\s*/g, " ")}`);
			expect(linksOf(parseSnapshot(snapshot))).toEqual([]);
		}
	});

	it("SU-NFR-01 raw HTML in the template text stays literal text", () => {
		const blocks = parseSnapshot("<b>bold?</b> <script>x()</script>");
		expect(blocks).toEqual([
			{ type: "paragraph", children: [{ type: "text", text: "<b>bold?</b> <script>x()</script>" }] },
		]);
	});

	it("SU-NFR-01 an unsafe link is shown as its literal source, never as a link", () => {
		for (const src of ["[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](//evil.example)", "[x](/relative)"]) {
			const blocks = parseSnapshot(src);
			expect(linksOf(blocks)).toEqual([]);
			expect(textOf(blocks)).toBe(src);
		}
	});

	it("SU-NFR-01 images never load: only their alt text is shown", () => {
		const blocks = parseSnapshot("See ![the logo](https://evil.example/x.png) here");
		expect(linksOf(blocks)).toEqual([]);
		expect(textOf(blocks)).toBe("See the logo here");
	});

	it("SU-NFR-01 hostile nesting and unmatched delimiters stay fast and bounded", () => {
		const deep = `${"[".repeat(5000)}x${"](https://a.example)".repeat(5000)}`;
		const stars = "*a ".repeat(20000);
		const started = performance.now();
		for (const src of [deep, stars, "`".repeat(30000), `${"> ".repeat(5000)}x`, "_".repeat(40000)]) parseSnapshot(src);
		expect(performance.now() - started).toBeLessThan(2000);
	});
});

describe("safeHref (SU-NFR-01)", () => {
	it("allows absolute http, https and mailto URLs only", () => {
		expect(safeHref("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
		expect(safeHref("http://example.com")).toBe("http://example.com/");
		expect(safeHref("mailto:ada@example.com")).toBe("mailto:ada@example.com");
		for (const bad of [
			"javascript:alert(1)",
			"JAVASCRIPT:alert(1)",
			"java\tscript:alert(1)",
			" javascript:alert(1)",
			"data:text/html,x",
			"vbscript:x",
			"//evil.example",
			"/relative",
			"relative",
			'https://ok.example/"onmouseover=x',
			"https://ok.example/<x>",
			"https://ok example",
			"file:///etc/passwd",
			"",
		]) {
			expect(safeHref(bad), bad).toBeUndefined();
		}
	});
});

describe("snapshot Markdown subset (SU-FR-03)", () => {
	it("SU-FR-03 renders headings (one level below the page title), paragraphs, lists, quotes, rules and code", () => {
		const blocks = parseSnapshot(
			[
				"# Agreement",
				"",
				"Intro line one",
				"line two",
				"",
				"## Terms",
				"- first",
				"- second",
				"",
				"3. three",
				"4. four",
				"",
				"> quoted",
				"",
				"---",
				"",
				"```",
				"code <b>",
				"```",
			].join("\n"),
		);
		expect(blocks.map((b) => b.type)).toEqual([
			"heading",
			"paragraph",
			"heading",
			"list",
			"list",
			"quote",
			"rule",
			"code",
		]);
		expect(blocks[0]).toEqual({ type: "heading", level: 2, children: [{ type: "text", text: "Agreement" }] });
		expect(blocks[1]).toEqual({
			type: "paragraph",
			children: [{ type: "text", text: "Intro line one" }, { type: "break" }, { type: "text", text: "line two" }],
		});
		expect(blocks[3]).toMatchObject({
			type: "list",
			ordered: false,
			items: [[{ text: "first" }], [{ text: "second" }]],
		});
		expect(blocks[4]).toMatchObject({ type: "list", ordered: true, start: 3 });
		expect(blocks[7]).toEqual({ type: "code", text: "code <b>" });
	});

	it("SU-FR-03 renders strong, emphasis, code spans and safe links", () => {
		const [p] = parseSnapshot(
			"**Bold** and *em* and _em_ and `x*y` and [site](https://example.com) and <https://a.example>",
		);
		expect(p).toEqual({
			type: "paragraph",
			children: [
				{ type: "strong", children: [{ type: "text", text: "Bold" }] },
				{ type: "text", text: " and " },
				{ type: "em", children: [{ type: "text", text: "em" }] },
				{ type: "text", text: " and " },
				{ type: "em", children: [{ type: "text", text: "em" }] },
				{ type: "text", text: " and " },
				{ type: "code", text: "x*y" },
				{ type: "text", text: " and " },
				{ type: "link", href: "https://example.com/", children: [{ type: "text", text: "site" }] },
				{ type: "text", text: " and " },
				{ type: "link", href: "https://a.example/", children: [{ type: "text", text: "https://a.example" }] },
			],
		});
	});

	it("SU-FR-03 intraword underscores and lone stars stay literal", () => {
		expect(textOf(parseSnapshot("snake_case_name and 2 * 3 * 4"))).toBe("snake_case_name and 2 * 3 * 4");
		expect(linksOf(parseSnapshot("snake_case_name"))).toEqual([]);
	});

	it("SU-FR-03 escaped values show as the signer typed them, never as Markdown", () => {
		const value = "# not a heading *not em* [not](https://a.example) & <b>";
		const blocks = parseSnapshot(escapeValue(value));
		expect(blocks).toEqual([{ type: "paragraph", children: [{ type: "text", text: value }] }]);
	});

	it("SU-FR-03 escapes are undone inside code, link text and unsafe link sources too", () => {
		expect(parseSnapshot("`a &lt;b&gt; \\*`")).toEqual([
			{ type: "paragraph", children: [{ type: "code", text: "a <b> *" }] },
		]);
		expect(parseSnapshot("```\nx &amp; y\n```")).toEqual([{ type: "code", text: "x & y" }]);
		expect(textOf(parseSnapshot("[a &amp; b](javascript:x)"))).toBe("[a & b](javascript:x)");
		expect(textOf(parseSnapshot("![a &amp; b](https://x.example/i.png)"))).toBe("a & b");
	});

	it("SU-FR-03 unfinished markup stays literal", () => {
		for (const src of ["stray ] bracket", "[x](https://a.example", "[x] (https://a.example)", "`open", "x **y"]) {
			expect(textOf(parseSnapshot(src)), src).toBe(src);
		}
		expect(parseSnapshot("*a `b* c`")[0]).toMatchObject({ children: [{ type: "em" }, { type: "text", text: " c`" }] });
		expect(parseSnapshot("#")).toEqual([{ type: "heading", level: 2, children: [] }]);
	});

	it("SU-FR-03 several emphasised runs on one line each close at their own delimiter", () => {
		const [p] = parseSnapshot("*a* and *b*");
		expect(p).toMatchObject({ children: [{ type: "em" }, { type: "text", text: " and " }, { type: "em" }] });
	});

	it("SU-FR-03 textOf gives the visible text of every kind of node", () => {
		const text = textOf(parseSnapshot("# T\n\na\nb `c`\n\n- x\n- y\n\n> q\n\n---\n\n```\nk\n```"));
		expect(text).toBe("T\n\na\nb c\n\nx\ny\n\nq\n\n\n\nk");
	});

	it("SU-FR-03 a list item may continue on an indented line", () => {
		expect(parseSnapshot("- one\n  more\n- two")).toEqual([
			{
				type: "list",
				ordered: false,
				items: [
					[{ type: "text", text: "one" }, { type: "break" }, { type: "text", text: "more" }],
					[{ type: "text", text: "two" }],
				],
			},
		]);
	});
});
