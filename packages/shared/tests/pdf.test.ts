import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measureText, type PdfDocument, renderPdf, toWinAnsi, wrapText } from "../src/pdf";
import { padStrokes, waiverDocument } from "./fixtures/pdf-waiver";
import { type ParsedPage, parsePdf, pdfText } from "./helpers/pdf-parse";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
/** PLATFORM_BUDGET.cpuMs (testing/budget.ts needs the workerd sandbox, so it is not imported here; R27). */
const LOCAL_CPU_CEILING_MS = 50;

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hasQpdf(): boolean {
	try {
		execFileSync("qpdf", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** Each text run must sit inside the page's left and right margins. */
function expectWithinMargins(page: ParsedPage, margin = MARGIN) {
	for (const run of page.text) {
		const font = run.font === "F2" ? "bold" : run.font === "F3" ? "italic" : "regular";
		const width = measureText(run.text, run.size, font);
		expect(run.x, run.text).toBeGreaterThanOrEqual(margin - 0.01);
		expect(run.x + width, run.text).toBeLessThanOrEqual(page.width - margin + 0.01);
	}
}

describe("T016 PDF writer: determinism (ES-FR-07)", () => {
	it("ES-FR-07: two renders of the same input are byte-identical", async () => {
		const a = renderPdf(waiverDocument());
		const b = renderPdf(structuredClone(waiverDocument()));
		expect(a.length).toBeGreaterThan(1000);
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
		expect(await sha256(a)).toBe(await sha256(b));
	});

	it("ES-FR-07: different input gives different bytes, and no clock or randomness leaks in", () => {
		const doc = waiverDocument();
		const base = renderPdf(doc);
		const changed = renderPdf({ ...doc, blocks: [...doc.blocks, { type: "paragraph", text: "x" }] });
		expect(Buffer.from(base).equals(Buffer.from(changed))).toBe(false);
		const text = Buffer.from(base).toString("latin1");
		expect(text).toContain("/CreationDate (D:20261021091630Z)");
		const undated = Buffer.from(renderPdf({ blocks: [{ type: "paragraph", text: "hi" }] })).toString("latin1");
		expect(undated).not.toContain("CreationDate");
		expect(undated).not.toContain("/ID");
	});
});

describe("T016 PDF writer: structure (ES-FR-07)", () => {
	it("ES-FR-07: output passes a strict pure-JS PDF parser", () => {
		const pdf = parsePdf(renderPdf(waiverDocument()));
		expect(pdf.version).toBe("1.7");
		expect(pdf.pages.length).toBeGreaterThanOrEqual(2);
		for (const page of pdf.pages) {
			expect(page.width).toBe(A4.width);
			expect(page.height).toBe(A4.height);
		}
		expect(pdf.info).toContain("/Title (Participation waiver)");
		expect(pdf.info).toContain("/Producer (semics pdf)");
	});

	it.skipIf(!hasQpdf())("ES-FR-07: output passes qpdf --check", () => {
		const dir = mkdtempSync(join(tmpdir(), "t016-"));
		try {
			const file = join(dir, "waiver.pdf");
			writeFileSync(file, renderPdf(waiverDocument()));
			expect(execFileSync("qpdf", ["--check", file], { encoding: "utf8" })).toMatch(/No syntax or stream encoding errors/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ES-FR-07: an empty document is a valid single blank page", () => {
		const pdf = parsePdf(renderPdf({ blocks: [] }));
		expect(pdf.pages).toHaveLength(1);
		expect(pdf.pages[0]?.text).toEqual([]);
	});

	it("ES-FR-07: numbers are written without exponents or negative zero", () => {
		const doc: PdfDocument = {
			page: { width: 300.123456, height: 400, margin: 20.000001 },
			blocks: [
				{ type: "spacer", height: 0.0000001 },
				{ type: "signature", strokes: { w: 1, h: 1, strokes: [[[0, 0], [1e-9, -1e-9], [1, 1]]] } },
			],
		};
		// The parser rejects exponent-form numbers and -0 in content streams.
		const pdf = parsePdf(renderPdf(doc));
		expect(pdf.pages[0]?.width).toBe(300.12);
	});
});

describe("T016 PDF writer: text and wrapping (ES-FR-07)", () => {
	it("encodes accents, quotes and the euro sign in WinAnsi and replaces what it cannot encode", () => {
		expect(toWinAnsi("café")).toBe("caf\xe9");
		expect(toWinAnsi("“quoted” – €5 … ‘a’")).toBe("\x93quoted\x94 \x96 \x805 \x85 \x91a\x92");
		expect(toWinAnsi("漢字 😀")).toBe("?? ?");
		expect(toWinAnsi("tab\there\r\n")).toBe("tab here  ");
	});

	it("measures with the Helvetica metrics", () => {
		expect(measureText("Hello", 10)).toBeCloseTo(22.78, 2);
		expect(measureText("Hello", 10, "bold")).toBeCloseTo(25, 2);
		expect(measureText("Hello", 10, "italic")).toBe(measureText("Hello", 10));
		expect(measureText("é", 1000)).toBe(556);
	});

	it("ES-FR-07: text with accents and long words wraps within margins", () => {
		const longWord = `Ångström${"é".repeat(40)}${"W".repeat(60)}`;
		const text = `Zoë and Renée signed at the café. ${"Naïve résumé façade jalapeño crème brûlée. ".repeat(12)}${longWord} end.`;
		const pdf = parsePdf(renderPdf({ blocks: [{ type: "paragraph", text }] }));
		const page = pdf.pages[0] as ParsedPage;
		expect(page.text.length).toBeGreaterThan(5);
		expectWithinMargins(page);
		const extracted = pdfText(pdf);
		expect(extracted).toContain("Zoë and Renée signed at the café.");
		expect(extracted).toContain("crème brûlée");
		// The over-long word is broken across lines but no character is lost.
		expect(page.text.map((t) => t.text).join("")).toContain(longWord.slice(0, 20));
		expect(page.text.map((t) => t.text).join("").replace(/\s/g, "")).toContain(longWord);
		// Lines go down the page.
		const ys = page.text.map((t) => t.y);
		expect([...ys].sort((a, b) => b - a)).toEqual(ys);
	});

	it("wrapText breaks on spaces, keeps explicit newlines and splits words wider than the line", () => {
		expect(wrapText("aaa bbb ccc", 10, measureText("aaa bbb", 10))).toEqual(["aaa bbb", "ccc"]);
		expect(wrapText("one\ntwo", 10, 500)).toEqual(["one", "two"]);
		expect(wrapText("one\n\ntwo", 10, 500)).toEqual(["one", "", "two"]);
		expect(wrapText("WWWWWW", 10, measureText("WW", 10))).toEqual(["WW", "WW", "WW"]);
		expect(wrapText("   ", 10, 100)).toEqual([""]);
	});

	it("escapes PDF string delimiters", () => {
		const pdf = parsePdf(renderPdf({ blocks: [{ type: "paragraph", text: "a (b) c\\d" }] }));
		expect(pdf.pages[0]?.text[0]?.text).toBe("a (b) c\\d");
	});

	it("centres and right-aligns lines", () => {
		const pdf = parsePdf(
			renderPdf({
				blocks: [
					{ type: "paragraph", text: "Centre", align: "center" },
					{ type: "paragraph", text: "Right", align: "right", font: "bold", size: 12 },
				],
			}),
		);
		const [centre, right] = pdf.pages[0]?.text ?? [];
		expect(centre?.x).toBeCloseTo((A4.width - measureText("Centre", 10)) / 2, 1);
		expect(right?.x).toBeCloseTo(A4.width - MARGIN - measureText("Right", 12, "bold"), 1);
		expect(right?.font).toBe("F2");
		expect(right?.size).toBe(12);
	});

	it("flows onto new pages, honours page breaks and numbers the pages in the footer", () => {
		const blocks: PdfDocument["blocks"] = [{ type: "heading", text: "Title", level: 1 }];
		for (let i = 0; i < 120; i++) blocks.push({ type: "paragraph", text: `Line ${i}` });
		blocks.push({ type: "pageBreak" }, { type: "heading", text: "Last", level: 3 });
		const pdf = parsePdf(renderPdf({ footer: { text: "REF-1", pageNumbers: true }, blocks }));
		const n = pdf.pages.length;
		expect(n).toBeGreaterThanOrEqual(3);
		pdf.pages.forEach((page, i) => {
			const footer = page.text.find((t) => t.text.startsWith("REF-1"));
			expect(footer?.text).toBe(`REF-1 · Page ${i + 1} of ${n}`);
			expect(footer?.y).toBeLessThan(MARGIN);
			for (const run of page.text) if (run !== footer) expect(run.y).toBeGreaterThanOrEqual(MARGIN - 0.01);
			expectWithinMargins(page);
		});
		expect(pdf.pages[n - 1]?.text[0]?.text).toBe("Last");
		expect(pdf.pages[0]?.text[0]).toMatchObject({ text: "Title", font: "F2", size: 18 });
		// A heading at the foot of a page moves to the next page with its text.
		const headingsAtFoot = pdf.pages.flatMap((p) => p.text.filter((t) => t.font === "F2" && t.y < MARGIN + 30));
		expect(headingsAtFoot).toEqual([]);
	});

	it("a footer with only page numbers, or only text", () => {
		const one = parsePdf(renderPdf({ footer: { pageNumbers: true }, blocks: [] }));
		expect(one.pages[0]?.text[0]?.text).toBe("Page 1 of 1");
		const two = parsePdf(renderPdf({ footer: { text: "Only" }, blocks: [] }));
		expect(two.pages[0]?.text[0]?.text).toBe("Only");
	});

	it("draws rules as paths", () => {
		const pdf = parsePdf(renderPdf({ blocks: [{ type: "rule" }] }));
		expect(pdf.pages[0]?.counts).toMatchObject({ m: 1, l: 1, S: 1 });
	});
});

describe("T016 PDF writer: tables (ES-FR-07)", () => {
	it("renders a header row, wraps cells within their columns and repeats the header on new pages", () => {
		const rows = Array.from({ length: 80 }, (_, i) => [`2026-10-21 09:${i}`, "signed", `détail ${"x".repeat(i % 7)} `.repeat(6)]);
		const pdf = parsePdf(
			renderPdf({
				blocks: [
					{
						type: "table",
						columns: [{ header: "Time", width: 1 }, { header: "Event", width: 1 }, { header: "Détails", width: 3 }],
						rows,
					},
				],
			}),
		);
		expect(pdf.pages.length).toBeGreaterThan(1);
		for (const page of pdf.pages) {
			const header = page.text.filter((t) => t.font === "F2").map((t) => t.text);
			expect(header).toEqual(["Time", "Event", "Détails"]);
			expectWithinMargins(page);
			expect(page.counts.re).toBeGreaterThan(0);
		}
		const text = pdfText(pdf);
		for (const row of rows) expect(text).toContain(row[0]);
		// Column 3 starts at 2/5 of the content width plus cell padding.
		const contentWidth = A4.width - 2 * MARGIN;
		const detail = pdf.pages[0]?.text.find((t) => t.text === "Détails");
		expect(detail?.x).toBeCloseTo(MARGIN + (contentWidth * 2) / 5 + 4, 1);
	});

	it("splits a row taller than a page, pads short rows and defaults column widths", () => {
		const tall = "word ".repeat(1500);
		const pdf = parsePdf(
			renderPdf({ blocks: [{ type: "table", columns: [{ header: "A" }, { header: "B" }], rows: [[tall], ["x", "y"]] }] }),
		);
		expect(pdf.pages.length).toBeGreaterThan(1);
		for (const page of pdf.pages) expectWithinMargins(page);
		expect(pdfText(pdf)).toContain("y");
	});
});

describe("T016 PDF writer: drawn signatures (ES-FR-07)", () => {
	it("ES-FR-07: stroke JSON renders as path operators, not images", () => {
		const strokes = padStrokes(3, 40);
		const pdf = parsePdf(renderPdf({ blocks: [{ type: "signature", label: "Signer", strokes, caption: ["Zoë"] }] }));
		const page = pdf.pages[0] as ParsedPage;
		expect(page.counts.m).toBe(3 + 1); // one move per stroke, plus the signature line
		expect(page.counts.l).toBe(3 * 39 + 1);
		expect(page.counts.S).toBe(3 + 1);
		expect(page.counts.Do).toBeUndefined();
		expect(page.counts.BI).toBeUndefined();
		for (const obj of pdf.objects.values()) {
			expect(obj.dict).not.toMatch(/\/XObject|\/Image|\/DCTDecode/);
		}
		expect(page.text.map((t) => t.text)).toEqual(["Signer", "Zoë"]);
	});

	it("fits strokes inside the signature box, keeping the aspect ratio and flipping y", () => {
		const pdf = parsePdf(
			renderPdf({
				blocks: [
					{
						type: "signature",
						width: 200,
						height: 50,
						strokes: { v: 1, w: 400, h: 100, strokes: [[{ x: 0, y: 0 }, { x: 400, y: 100 }], [[200, 50]]] },
					},
				],
			}),
		);
		const page = pdf.pages[0] as ParsedPage;
		const points = page.ops.filter((o) => o.op === "m" || o.op === "l").map((o) => o.operands as number[]);
		const [first, second, dot] = points;
		expect(first?.[0]).toBeCloseTo(MARGIN, 1);
		expect(second?.[0]).toBeCloseTo(MARGIN + 200, 1);
		// Pad y grows downwards, PDF y grows upwards: the pad's top-left is the box's top-left.
		expect((first?.[1] as number) - (second?.[1] as number)).toBeCloseTo(50, 1);
		// A one-point stroke is drawn as a dot (zero-length line with round caps).
		expect(dot).toEqual(points[3]);
		expect(page.ops.some((o) => o.op === "J" && o.operands[0] === 1)).toBe(true);
	});

	it("skips invalid points and empty strokes, and renders a typed signature in oblique", () => {
		const pdf = parsePdf(
			renderPdf({
				blocks: [
					{
						type: "signature",
						typedName: "Renée Ångström",
						strokes: {
							w: 0,
							h: Number.NaN,
							strokes: [[], [[Number.NaN, 1], [1, Number.POSITIVE_INFINITY]], [[1, 2], [3, 4]], "bad" as never],
						},
					},
					{ type: "signature", strokes: { w: 10, h: 10, strokes: "nope" as never } },
				],
			}),
		);
		const page = pdf.pages[0] as ParsedPage;
		expect(page.counts.m).toBe(1 + 2);
		expect(page.text.find((t) => t.font === "F3")?.text).toBe("Renée Ångström");
	});

	it("moves a signature block that does not fit to the next page", () => {
		const blocks: PdfDocument["blocks"] = [{ type: "spacer", height: A4.height - 2 * MARGIN - 40 }];
		blocks.push({ type: "signature", label: "Late", strokes: padStrokes(1, 5) });
		const pdf = parsePdf(renderPdf({ blocks }));
		expect(pdf.pages).toHaveLength(2);
		expect(pdf.pages[1]?.text[0]?.text).toBe("Late");
	});
});

describe("T016 PDF writer: budget (ES-NFR-01, Spike S5 local proxy)", () => {
	it("ES-NFR-01: a 5-page waiver with 2 signatures renders and hashes under the local CPU ceiling", async () => {
		const doc = waiverDocument();
		expect(parsePdf(renderPdf(doc)).pages).toHaveLength(5);
		renderPdf(doc); // warm up, as a warm isolate would be
		const samples: number[] = [];
		for (let run = 0; run < 5; run++) {
			const start = process.cpuUsage();
			await sha256(renderPdf(doc));
			const used = process.cpuUsage(start);
			samples.push((used.user + used.system) / 1000);
		}
		samples.sort((a, b) => a - b);
		expect(samples[2]).toBeLessThan(LOCAL_CPU_CEILING_MS);
	});
});
