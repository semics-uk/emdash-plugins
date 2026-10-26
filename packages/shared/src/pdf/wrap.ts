import { type PdfFont, toWinAnsi, unitsOf, widthTable } from "./fonts";

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
	const widths = widthTable(font);
	const spaceUnits = unitsOf(SPACE, font);
	const out: Line[] = [];
	// The words of the line being filled, as flat [start, end) pairs, reused across lines. Long
	// documents have ~100k words, so the loop avoids a regex match and an array per word (T125).
	const spans: number[] = [];
	for (const paragraph of text.split(/\r\n|\r|\n/)) {
		// `bytes` has one byte per code point; index the text the same way (only surrogates differ).
		const chars = /[\ud800-\udfff]/.test(paragraph) ? Array.from(paragraph) : undefined;
		const slice = (a: number, b: number) => (chars ? chars.slice(a, b).join("") : paragraph.slice(a, b));
		const bytes = toWinAnsi(paragraph);
		let units = 0;
		let wordChars = 0;
		const flush = () => {
			const count = spans.length / 2;
			const first = spans[0] ?? 0;
			const last = spans[spans.length - 1] ?? 0;
			// Words separated by single spaces are one slice of the source (the common case); runs of
			// spaces collapse to one, so then the words are joined.
			const contiguous = count > 0 && last - first === wordChars + count - 1;
			let lineText: string;
			let lineBytes: string;
			if (contiguous) {
				lineText = slice(first, last);
				lineBytes = bytes.slice(first, last);
			} else {
				const texts: string[] = [];
				const parts: string[] = [];
				for (let i = 0; i < spans.length; i += 2) {
					texts.push(slice(spans[i] as number, spans[i + 1] as number));
					parts.push(bytes.slice(spans[i] as number, spans[i + 1] as number));
				}
				lineText = texts.join(" ");
				lineBytes = parts.join(SPACE);
			}
			out.push({ text: lineText, bytes: lineBytes, width: (units * size) / 1000 });
			spans.length = 0;
			units = 0;
			wordChars = 0;
		};
		const before = out.length;
		for (let next = 0; next < bytes.length; ) {
			if (bytes.charCodeAt(next) === 32) {
				next++;
				continue;
			}
			let start = next;
			const space = bytes.indexOf(" ", start);
			const end = space === -1 ? bytes.length : space;
			next = end;
			let wordUnits = 0;
			for (let i = start; i < end; i++) wordUnits += widths[bytes.charCodeAt(i)] as number;
			if (spans.length > 0 && (units + spaceUnits + wordUnits) * size <= limit) {
				spans.push(start, end);
				units += spaceUnits + wordUnits;
				wordChars += end - start;
				continue;
			}
			if (spans.length > 0) flush();
			if (wordUnits * size <= limit) {
				spans.push(start, end);
				units = wordUnits;
				wordChars = end - start;
				continue;
			}
			// Wider than a whole line: cut it into line-sized pieces, at least one character each.
			while (start < end) {
				let cut = start;
				let pieceUnits = 0;
				while (cut < end) {
					const charUnits = widths[bytes.charCodeAt(cut)] as number;
					if (cut > start && (pieceUnits + charUnits) * size > limit) break;
					pieceUnits += charUnits;
					cut++;
				}
				spans.length = 0;
				spans.push(start, cut);
				units = pieceUnits;
				wordChars = cut - start;
				if (cut < end) flush();
				start = cut;
			}
		}
		if (spans.length > 0 || out.length === before) flush();
	}
	return out;
}

/** Wrap `text` to lines no wider than `maxWidth` points at `size` points in `font`. */
export function wrapText(text: string, size: number, maxWidth: number, font: PdfFont = "regular"): string[] {
	return layoutLines(text, size, maxWidth, font).map((line) => line.text);
}
