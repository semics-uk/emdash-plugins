import { type PdfFont, toWinAnsi, unitsOf } from "./fonts";

/** One laid-out line: the Unicode text, its WinAnsi bytes and its width in points. */
export interface Line {
	text: string;
	bytes: string;
	width: number;
}

const SPACE = toWinAnsi(" ");

/**
 * Greedy line breaking with the Helvetica metrics. Breaks on spaces (runs of spaces collapse to
 * one), keeps explicit newlines, and splits a word wider than the line between characters.
 */
export function layoutLines(text: string, size: number, maxWidth: number, font: PdfFont): Line[] {
	const limit = maxWidth * 1000 + 1e-6; // compare in font units x size, so sums never drift
	const spaceUnits = unitsOf(SPACE, font);
	const out: Line[] = [];
	for (const paragraph of text.split(/\r\n|\r|\n/)) {
		// `bytes` has one byte per code point; index the text the same way (only surrogates differ).
		const chars = /[\ud800-\udfff]/.test(paragraph) ? Array.from(paragraph) : undefined;
		const slice = (a: number, b: number) => (chars ? chars.slice(a, b).join("") : paragraph.slice(a, b));
		const bytes = toWinAnsi(paragraph);
		let words: Array<[number, number]> = [];
		let units = 0;
		const flush = () => {
			const lineText = words.map(([a, b]) => slice(a, b)).join(" ");
			const lineBytes = words.map(([a, b]) => bytes.slice(a, b)).join(SPACE);
			out.push({ text: lineText, bytes: lineBytes, width: (units * size) / 1000 });
			words = [];
			units = 0;
		};
		const before = out.length;
		for (const match of bytes.matchAll(/[^ ]+/g)) {
			let start = match.index;
			const end = start + match[0].length;
			const wordUnits = unitsOf(match[0], font);
			if (words.length > 0 && (units + spaceUnits + wordUnits) * size <= limit) {
				words.push([start, end]);
				units += spaceUnits + wordUnits;
				continue;
			}
			if (words.length > 0) flush();
			if (wordUnits * size <= limit) {
				words.push([start, end]);
				units = wordUnits;
				continue;
			}
			// Wider than a whole line: cut it into line-sized pieces, at least one character each.
			while (start < end) {
				let cut = start;
				let pieceUnits = 0;
				while (cut < end) {
					const charUnits = unitsOf(bytes.charAt(cut), font);
					if (cut > start && (pieceUnits + charUnits) * size > limit) break;
					pieceUnits += charUnits;
					cut++;
				}
				words = [[start, cut]];
				units = pieceUnits;
				if (cut < end) flush();
				start = cut;
			}
		}
		if (words.length > 0 || out.length === before) flush();
	}
	return out;
}

/** Wrap `text` to lines no wider than `maxWidth` points at `size` points in `font`. */
export function wrapText(text: string, size: number, maxWidth: number, font: PdfFont = "regular"): string[] {
	return layoutLines(text, size, maxWidth, font).map((line) => line.text);
}
