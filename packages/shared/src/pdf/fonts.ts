/**
 * Standard-14 Helvetica metrics (Adobe AFM widths, 1/1000 em) and WinAnsiEncoding. The writer never
 * embeds a font: every PDF reader ships Helvetica, Helvetica-Bold and Helvetica-Oblique, and the
 * oblique face has the regular face's widths.
 */

export type PdfFont = "regular" | "bold" | "italic";

/** Resource names and base fonts, in object order. */
export const FONTS: ReadonlyArray<{ font: PdfFont; resource: string; baseFont: string }> = [
	{ font: "regular", resource: "F1", baseFont: "Helvetica" },
	{ font: "bold", resource: "F2", baseFont: "Helvetica-Bold" },
	{ font: "italic", resource: "F3", baseFont: "Helvetica-Oblique" },
];

/**
 * Widths of codes 0x20-0xFF (0x80-0x9F: WinAnsi; 0 = unassigned), two base-36 digits each, from the
 * Adobe AFM files. Packed this way to keep the sandboxed bundles small (R42); `tests/pdf.test.ts`
 * spot-checks them against the AFM values.
 */
const REGULAR_WIDTHS =
	"7q7q9vfgfgopij5b9999atg87q997q7qfgfgfgfgfgfgfgfgfgfg7q7qg8g8g8fgs7ijijk2k2ijgzlmk27qdwijfgn5k2lmijlmk2ijgzk2ijq8ijijgz7q7q7qd1fg99fgfgdwfgfg7qfgfg6666dw66n5fgfgfgfg99dw7qfgdwk2dwdwdw9a789ag800fg0066fg99rsfgfg99rsij99rs00gz0000666699999qfgrs99rsdw99q800dwij7q99fgfgfgfg78fg99khaafgg899kh99b4g8999999fgex7q9999a5fgn6n6n6gzijijijijijijrsk2ijijijij7q7q7q7qk2k2lmlmlmlmlmg8lmk2k2k2k2ijijgzfgfgfgfgfgfgopdwfgfgfgfg7q7q7q7qfgfgfgfgfgfgfgg8gzfgfgfgfgdwfgdw";
const BOLD_WIDTHS =
	"7q99d6fgfgopk26m9999atg87q997q7qfgfgfgfgfgfgfgfgfgfg9999g8g8g8gzr3k2k2k2k2ijgzlmk27qfgk2gzn5k2lmijlmk2ijgzk2ijq8ijijgz997q99g8fg99fggzfggzfg99gzgz7q7qfg7qopgzgzgzgzatfg99gzfglmfgfgdwat7satg800fg007qfgdwrsfgfg99rsij99rs00gz00007q7qdwdw9qfgrs99rsfg99q800dwij7q99fgfgfgfg7sfg99khaafgg899kh99b4g8999999gzfg7q9999a5fgn6n6n6gzk2k2k2k2k2k2rsk2ijijijij7q7q7q7qk2k2lmlmlmlmlmg8lmk2k2k2k2ijijgzfgfgfgfgfgfgopfgfgfgfgfg7q7q7q7qgzgzgzgzgzgzgzg8gzgzgzgzgzfggzfg";

/** Width of every byte 0-255 for one face; control codes are 0 (never emitted). */
function table(packed: string): Uint16Array {
	const widths = new Uint16Array(256);
	for (let i = 0; i < 224; i++) widths[0x20 + i] = Number.parseInt(packed.slice(2 * i, 2 * i + 2), 36);
	return widths;
}

const REGULAR = table(REGULAR_WIDTHS);
const WIDTHS: Record<PdfFont, Uint16Array> = {
	regular: REGULAR,
	bold: table(BOLD_WIDTHS),
	italic: REGULAR,
};

/** Unicode code points that WinAnsi places in 0x80-0x9F, in byte order (0 = unassigned). */
const WIN_ANSI_HIGH = new Map<number, number>(
	[
		0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0,
		0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
	].flatMap((cp, i) => (cp ? [[cp, 0x80 + i] as [number, number]] : [])),
);

const QUESTION = 0x3f;
const DIRECT = /^[\x20-\x7e\xa0-\xff]*$/;

/** One Unicode code point to its WinAnsi byte; whitespace becomes a space, anything else unencodable `?`. */
function winAnsiByte(cp: number): number {
	if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
	if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return 0x20;
	return WIN_ANSI_HIGH.get(cp) ?? QUESTION;
}

/**
 * Encode text as WinAnsi bytes, returned as a string of char codes 0-255. Characters outside WinAnsi
 * (CJK, emoji, ...) become `?`: the standard fonts have no glyphs for them.
 */
export function toWinAnsi(text: string): string {
	if (DIRECT.test(text)) return text; // printable ASCII and Latin-1 map to themselves
	let out = "";
	for (const ch of text) out += String.fromCharCode(winAnsiByte(ch.codePointAt(0) as number));
	return out;
}

/** Width of WinAnsi-encoded bytes in 1/1000 em. */
export function unitsOf(bytes: string, font: PdfFont): number {
	const widths = WIDTHS[font];
	let units = 0;
	for (let i = 0; i < bytes.length; i++) units += widths[bytes.charCodeAt(i)] as number;
	return units;
}

/** Width in points of `text` set in `font` at `size` points. */
export function measureText(text: string, size: number, font: PdfFont = "regular"): number {
	return (unitsOf(toWinAnsi(text), font) * size) / 1000;
}
