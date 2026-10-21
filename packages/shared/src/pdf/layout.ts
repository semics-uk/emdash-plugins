import { FONTS, type PdfFont } from "./fonts";
import { type SignatureStrokes, strokeOps } from "./strokes";
import { type Line, layoutLines } from "./wrap";
import { literal, num } from "./writer";

export interface PdfMargins {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface PdfPageSetup {
	/** Points; default A4 (595.28 x 841.89). */
	width?: number;
	height?: number;
	/** Points, one value for all sides or per side; default 56 (about 20 mm). */
	margin?: number | Partial<PdfMargins>;
}

export type PdfAlign = "left" | "center" | "right";

export type PdfBlock =
	| { type: "heading"; text: string; level?: 1 | 2 | 3 }
	| { type: "paragraph"; text: string; size?: number; font?: PdfFont; align?: PdfAlign }
	| { type: "spacer"; height: number }
	| { type: "rule" }
	| { type: "pageBreak" }
	| {
			type: "table";
			/** `width` is a relative weight (default 1). */
			columns: Array<{ header: string; width?: number }>;
			rows: string[][];
			size?: number;
	  }
	| {
			type: "signature";
			/** Small text above the box, e.g. "Participant". */
			label?: string;
			/** Drawn signature, rendered as vector paths. */
			strokes?: SignatureStrokes;
			/** Typed signature, set in Helvetica-Oblique. */
			typedName?: string;
			/** Lines under the signature line: name, date, ... */
			caption?: string[];
			/** Box size in points; default 220 x 70. */
			width?: number;
			height?: number;
	  };

export interface PdfFooter {
	text?: string;
	/** Append "Page n of N". */
	pageNumbers?: boolean;
}

const A4 = { width: 595.28, height: 841.89 };
const DEFAULT_MARGIN = 56;
const BODY_SIZE = 10;
const LEADING = 1.3;
const HEADING_SIZE = { 1: 18, 2: 13, 3: 11 } as const;
const TABLE_SIZE = 9;
const CELL_PAD = 4;
const FOOTER_SIZE = 8;
const RESOURCE: Record<PdfFont, string> = Object.fromEntries(FONTS.map((f) => [f.font, f.resource])) as Record<
	PdfFont,
	string
>;

const positive = (n: unknown, fallback: number): number =>
	typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback;
const nonNegative = (n: unknown, fallback: number): number =>
	typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : fallback;
const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const fontOf = (f: unknown): PdfFont => (f === "bold" || f === "italic" ? f : "regular");

export interface PageGeometry {
	width: number;
	height: number;
	margin: PdfMargins;
}

/** Resolve the page setup, falling back to A4 / 56 pt for anything unusable. */
export function pageGeometry(setup: PdfPageSetup | undefined): PageGeometry {
	const width = Math.round(positive(setup?.width, A4.width) * 100) / 100;
	const height = Math.round(positive(setup?.height, A4.height) * 100) / 100;
	const m = setup?.margin;
	const side = (key: keyof PdfMargins) =>
		nonNegative(typeof m === "number" ? m : typeof m === "object" && m !== null ? m[key] : undefined, DEFAULT_MARGIN);
	let margin: PdfMargins = { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
	// Keep at least a 72 pt square to lay out into.
	if (width - margin.left - margin.right < 72 || height - margin.top - margin.bottom < 72) {
		const fit = Math.max(0, Math.min((width - 72) / 2, (height - 72) / 2, DEFAULT_MARGIN));
		margin = { top: fit, right: fit, bottom: fit, left: fit };
	}
	return { width, height, margin };
}

/** Flows blocks down pages. Coordinates are top-down (`y` from the top edge) until written. */
class Layout {
	readonly pages: string[][] = [];
	private ops: string[] = [];
	private y: number;
	private readonly left: number;
	private readonly right: number;
	private readonly bottom: number;

	constructor(private readonly g: PageGeometry) {
		this.left = g.margin.left;
		this.right = g.width - g.margin.right;
		this.bottom = g.height - g.margin.bottom;
		this.y = g.margin.top;
		this.pages.push(this.ops);
	}

	get contentWidth(): number {
		return this.right - this.left;
	}

	private get atTop(): boolean {
		return this.y <= this.g.margin.top;
	}

	newPage(): void {
		this.ops = [];
		this.pages.push(this.ops);
		this.y = this.g.margin.top;
	}

	/** Start a new page unless `height` fits below the cursor (or the page is still empty). */
	ensure(height: number): void {
		if (this.y + height > this.bottom + 1e-6 && !this.atTop) this.newPage();
	}

	private pdfY(y: number): string {
		return num(this.g.height - y);
	}

	/** One line of text whose line box starts at top-down `y`. */
	private text(x: number, y: number, size: number, font: PdfFont, bytes: string): void {
		if (bytes.length === 0) return;
		this.ops.push(`BT /${RESOURCE[font]} ${num(size)} Tf ${num(x)} ${this.pdfY(y + size)} Td ${literal(bytes)} Tj ET`);
	}

	private alignX(line: Line, align: PdfAlign, left = this.left, width = this.contentWidth): number {
		if (align === "center") return left + (width - line.width) / 2;
		if (align === "right") return left + width - line.width;
		return left;
	}

	paragraph(text: string, size: number, font: PdfFont, align: PdfAlign, spaceAfter: number): void {
		const lineHeight = size * LEADING;
		for (const line of layoutLines(text, size, this.contentWidth, font)) {
			this.ensure(lineHeight);
			this.text(this.alignX(line, align), this.y, size, font, line.bytes);
			this.y += lineHeight;
		}
		this.y += spaceAfter;
	}

	heading(text: string, level: 1 | 2 | 3): void {
		const size = HEADING_SIZE[level];
		const lines = layoutLines(text, size, this.contentWidth, "bold");
		const before = this.atTop ? 0 : size * 0.6;
		// Keep the heading with at least two lines of what follows.
		this.ensure(before + lines.length * size * LEADING + size * 0.4 + 2 * BODY_SIZE * LEADING);
		if (!this.atTop) this.y += before;
		this.paragraph(text, size, "bold", "left", size * 0.4);
	}

	spacer(height: number): void {
		this.y += height;
		if (this.y > this.bottom) this.newPage();
	}

	rule(): void {
		this.ensure(12);
		const y = this.pdfY(this.y + 6);
		this.ops.push(`0.75 w 0.6 G ${num(this.left)} ${y} m ${num(this.right)} ${y} l S 0 G`);
		this.y += 12;
	}

	pageBreak(): void {
		if (!this.atTop) this.newPage();
	}

	table(columns: Array<{ header: string; width?: number }>, rows: unknown[][], size: number): void {
		if (columns.length === 0) return;
		const weights = columns.map((c) => positive(c.width, 1));
		const total = weights.reduce((a, b) => a + b, 0);
		const xs: number[] = [];
		const widths = weights.map((w) => (this.contentWidth * w) / total);
		widths.reduce((x, w) => {
			xs.push(x);
			return x + w;
		}, this.left);
		const lineHeight = size * LEADING;
		const wrapCells = (cells: unknown[], font: PdfFont) =>
			widths.map((w, i) => layoutLines(str(cells[i]), size, w - 2 * CELL_PAD, font));
		const header = wrapCells(
			columns.map((c) => c.header),
			"bold",
		);
		const rowLines = (cells: Line[][]) => Math.max(1, ...cells.map((c) => c.length));
		const headerHeight = rowLines(header) * lineHeight + 2 * CELL_PAD;

		const drawRow = (cells: Line[][], from: number, count: number, font: PdfFont, fill: boolean) => {
			const height = count * lineHeight + 2 * CELL_PAD;
			const top = this.pdfY(this.y + height);
			if (fill) this.ops.push(`0.92 g ${num(this.left)} ${top} ${num(this.contentWidth)} ${num(height)} re f 0 g`);
			this.ops.push("0.5 w 0.7 G");
			for (let c = 0; c < widths.length; c++) {
				this.ops.push(`${num(xs[c] as number)} ${top} ${num(widths[c] as number)} ${num(height)} re S`);
			}
			this.ops.push("0 G");
			cells.forEach((lines, c) => {
				for (let k = 0; k < count; k++) {
					const line = lines[from + k];
					if (line) {
						this.text((xs[c] as number) + CELL_PAD, this.y + CELL_PAD + k * lineHeight, size, font, line.bytes);
					}
				}
			});
			this.y += height;
		};
		const drawHeader = () => drawRow(header, 0, rowLines(header), "bold", true);

		this.ensure(headerHeight + lineHeight + 2 * CELL_PAD);
		drawHeader();
		let fresh = true;
		for (const row of rows) {
			const cells = wrapCells(Array.isArray(row) ? row : [], "regular");
			const lines = rowLines(cells);
			let from = 0;
			while (from < lines) {
				const fit = Math.floor((this.bottom - this.y - 2 * CELL_PAD + 1e-6) / lineHeight);
				const remaining = lines - from;
				if (fit >= remaining) {
					drawRow(cells, from, remaining, "regular", false);
					fresh = false;
					break;
				}
				if (fresh) {
					// Taller than a whole page: split the row at a line boundary (always making progress).
					const count = Math.max(1, fit);
					drawRow(cells, from, count, "regular", false);
					from += count;
					if (from >= lines) break;
				}
				this.newPage();
				drawHeader();
				fresh = true;
			}
		}
		this.y += BODY_SIZE * 0.5;
	}

	signature(block: Extract<PdfBlock, { type: "signature" }>): void {
		const width = Math.min(positive(block.width, 220), this.contentWidth);
		const height = positive(block.height, 70);
		const label = layoutLines(str(block.label), 9, this.contentWidth, "regular").filter((l) => l.bytes);
		const caption = (Array.isArray(block.caption) ? block.caption : [])
			.flatMap((c) => layoutLines(str(c), 9, this.contentWidth, "regular"))
			.filter((l) => l.bytes);
		const small = 9 * LEADING;
		this.ensure(label.length * small + height + 4 + caption.length * small);
		for (const line of label) {
			this.text(this.left, this.y, 9, "regular", line.bytes);
			this.y += small;
		}
		const boxTop = this.y;
		const typed = layoutLines(str(block.typedName), 20, width, "italic")[0];
		if (typed?.bytes) this.text(this.left + 4, boxTop + height - 28, 20, "italic", typed.bytes);
		const ink = strokeOps(block.strokes, { x: this.left, top: this.g.height - boxTop, width, height });
		if (ink) this.ops.push(ink);
		this.y = boxTop + height + 2;
		const lineY = this.pdfY(this.y);
		this.ops.push(`0.5 w 0.4 G ${num(this.left)} ${lineY} m ${num(this.left + width)} ${lineY} l S 0 G`);
		this.y += 2;
		for (const line of caption) {
			this.text(this.left, this.y, 9, "regular", line.bytes);
			this.y += small;
		}
		this.y += 12;
	}

	block(block: PdfBlock): void {
		switch (block.type) {
			case "heading":
				this.heading(str(block.text), block.level === 2 || block.level === 3 ? block.level : 1);
				break;
			case "paragraph": {
				const size = positive(block.size, BODY_SIZE);
				const align = block.align === "center" || block.align === "right" ? block.align : "left";
				this.paragraph(str(block.text), size, fontOf(block.font), align, size * 0.5);
				break;
			}
			case "spacer":
				this.spacer(nonNegative(block.height, 0));
				break;
			case "rule":
				this.rule();
				break;
			case "pageBreak":
				this.pageBreak();
				break;
			case "table":
				this.table(
					Array.isArray(block.columns) ? block.columns : [],
					Array.isArray(block.rows) ? block.rows : [],
					positive(block.size, TABLE_SIZE),
				);
				break;
			case "signature":
				this.signature(block);
				break;
		}
	}

	/** Footer on every page, once the page count is known. */
	footer(footer: PdfFooter | undefined): void {
		if (!footer) return;
		const text = str(footer.text);
		const n = this.pages.length;
		this.pages.forEach((ops, i) => {
			const parts = [text, footer.pageNumbers ? `Page ${i + 1} of ${n}` : ""].filter(Boolean);
			if (parts.length === 0) return;
			const [line] = layoutLines(parts.join(" · "), FOOTER_SIZE, this.contentWidth, "regular") as [Line];
			const x = this.alignX(line, "center");
			const baseline = this.g.margin.bottom / 2;
			ops.push(`BT /F1 ${FOOTER_SIZE} Tf ${num(x)} ${num(baseline)} Td ${literal(line.bytes)} Tj ET`);
		});
	}
}

/** Lay `blocks` out on pages; returns each page's content stream. */
export function layoutPages(geometry: PageGeometry, blocks: readonly PdfBlock[], footer?: PdfFooter): string[] {
	const layout = new Layout(geometry);
	for (const block of Array.isArray(blocks) ? blocks : []) {
		if (block && typeof block === "object") layout.block(block);
	}
	layout.footer(footer);
	return layout.pages.map((ops) => ops.join("\n"));
}
