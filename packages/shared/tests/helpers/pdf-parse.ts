/**
 * Test-only structural PDF checker (T016). Independent of the writer: it re-reads the bytes the way a
 * strict reader would (header, xref table offsets, object framing, stream lengths, trailer, page tree)
 * and tokenises every content stream, so a broken file fails loudly. It understands the subset the
 * writer emits (classic xref, uncompressed streams), which is all a valid T016 file may contain.
 */

export interface ParsedObject {
	num: number;
	/** Text between `N 0 obj` and `stream`/`endobj`. */
	dict: string;
	/** Raw stream bytes as a latin1 string, when the object is a stream. */
	stream?: string;
}

export interface TextRun {
	font: string;
	size: number;
	x: number;
	y: number;
	/** Decoded from WinAnsi to Unicode. */
	text: string;
}

export interface ParsedPage {
	width: number;
	height: number;
	ops: Array<{ op: string; operands: unknown[] }>;
	text: TextRun[];
	/** Operator counts (m, l, c, S, re, f, Do, BI, ...). */
	counts: Record<string, number>;
	/** Raw content stream. */
	content: string;
}

export interface ParsedPdf {
	version: string;
	objects: Map<number, ParsedObject>;
	trailer: string;
	info?: string;
	pages: ParsedPage[];
}

const WIN_ANSI_HIGH: Record<number, number> = {
	0x80: 0x20ac,
	0x82: 0x201a,
	0x83: 0x0192,
	0x84: 0x201e,
	0x85: 0x2026,
	0x86: 0x2020,
	0x87: 0x2021,
	0x88: 0x02c6,
	0x89: 0x2030,
	0x8a: 0x0160,
	0x8b: 0x2039,
	0x8c: 0x0152,
	0x8e: 0x017d,
	0x91: 0x2018,
	0x92: 0x2019,
	0x93: 0x201c,
	0x94: 0x201d,
	0x95: 0x2022,
	0x96: 0x2013,
	0x97: 0x2014,
	0x98: 0x02dc,
	0x99: 0x2122,
	0x9a: 0x0161,
	0x9b: 0x203a,
	0x9c: 0x0153,
	0x9e: 0x017e,
	0x9f: 0x0178,
};

function decodeWinAnsi(bytes: string): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes.charCodeAt(i);
		out += String.fromCharCode(WIN_ANSI_HIGH[b] ?? b);
	}
	return out;
}

function fail(message: string): never {
	throw new Error(`Invalid PDF: ${message}`);
}

/** Known content-stream operators and their operand counts (-1: any). */
const OPERATORS: Record<string, number> = {
	q: 0,
	Q: 0,
	cm: 6,
	w: 1,
	J: 1,
	j: 1,
	M: 1,
	d: 2,
	m: 2,
	l: 2,
	c: 6,
	h: 0,
	re: 4,
	S: 0,
	s: 0,
	f: 0,
	B: 0,
	n: 0,
	g: 1,
	G: 1,
	rg: 3,
	RG: 3,
	BT: 0,
	ET: 0,
	Tf: 2,
	Td: 2,
	TL: 1,
	Tm: 6,
	"T*": 0,
	Tj: 1,
	TJ: 1,
	Tc: 1,
	Tw: 1,
	Do: 1,
	BI: 0,
};

type Token = number | string | { name: string } | { str: string } | unknown[];

function tokenize(src: string): Array<Token | { op: string }> {
	const out: Array<Token | { op: string }> = [];
	const stack: unknown[][] = [];
	const push = (t: Token | { op: string }) => {
		const top = stack[stack.length - 1];
		if (top) top.push(t);
		else out.push(t);
	};
	let i = 0;
	while (i < src.length) {
		const ch = src[i] as string;
		if (/\s/.test(ch)) {
			i++;
		} else if (ch === "%") {
			while (i < src.length && src[i] !== "\n") i++;
		} else if (ch === "(") {
			let depth = 1;
			let s = "";
			i++;
			while (depth > 0) {
				if (i >= src.length) fail("unterminated string");
				const c = src[i] as string;
				if (c === "\\") {
					const n = src[i + 1] as string;
					if (/[0-7]/.test(n)) {
						const m = /^[0-7]{1,3}/.exec(src.slice(i + 1)) as RegExpExecArray;
						s += String.fromCharCode(Number.parseInt(m[0], 8));
						i += 1 + m[0].length;
						continue;
					}
					const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
					s += map[n] ?? n;
					i += 2;
					continue;
				}
				if (c === "(") depth++;
				if (c === ")") depth--;
				if (depth > 0) s += c;
				i++;
			}
			push({ str: s });
		} else if (ch === "/") {
			const m = /^\/[^\s/[\]()<>{}%]*/.exec(src.slice(i)) as RegExpExecArray;
			push({ name: m[0].slice(1) });
			i += m[0].length;
		} else if (ch === "[") {
			stack.push([]);
			i++;
		} else if (ch === "]") {
			const arr = stack.pop() ?? fail("unbalanced ]");
			push(arr as Token);
			i++;
		} else {
			const m = /^[^\s/[\]()<>{}%]+/.exec(src.slice(i));
			if (!m) fail(`unexpected character ${JSON.stringify(ch)} in content stream`);
			const word = m[0];
			if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
				if (/e/i.test(word)) fail(`number in exponent form: ${word}`);
				if (word === "-0") fail("negative zero");
				push(Number(word));
			} else {
				push({ op: word });
			}
			i += word.length;
		}
	}
	if (stack.length) fail("unbalanced [");
	return out;
}

function parseContent(content: string): Pick<ParsedPage, "ops" | "text" | "counts"> {
	const ops: ParsedPage["ops"] = [];
	const text: TextRun[] = [];
	const counts: Record<string, number> = {};
	let operands: unknown[] = [];
	let inText = false;
	let qDepth = 0;
	let font = "";
	let size = 0;
	let tx = 0;
	let ty = 0;
	for (const token of tokenize(content)) {
		if (typeof token === "object" && token !== null && "op" in token) {
			const op = token.op;
			const arity = OPERATORS[op];
			if (arity === undefined) fail(`unknown operator ${op}`);
			if (arity >= 0 && operands.length !== arity) fail(`${op} takes ${arity} operands, got ${operands.length}`);
			counts[op] = (counts[op] ?? 0) + 1;
			ops.push({ op, operands });
			if (op === "BT") {
				if (inText) fail("nested BT");
				inText = true;
				tx = 0;
				ty = 0;
			} else if (op === "ET") {
				if (!inText) fail("ET without BT");
				inText = false;
			} else if (op === "q") qDepth++;
			else if (op === "Q") {
				if (--qDepth < 0) fail("Q without q");
			} else if (op === "Tf") {
				font = (operands[0] as { name: string }).name;
				size = operands[1] as number;
			} else if (op === "Td") {
				tx += operands[0] as number;
				ty += operands[1] as number;
			} else if (op === "Tj") {
				if (!inText) fail("Tj outside BT");
				text.push({ font, size, x: tx, y: ty, text: decodeWinAnsi((operands[0] as { str: string }).str) });
			}
			operands = [];
		} else {
			operands.push(token);
		}
	}
	if (operands.length) fail("dangling operands at end of content stream");
	if (inText) fail("BT without ET");
	if (qDepth !== 0) fail("unbalanced q/Q");
	return { ops, text, counts };
}

function ref(dict: string, key: string): number {
	const m = new RegExp(`/${key} (\\d+) 0 R`).exec(dict);
	if (!m) fail(`missing /${key} reference in ${dict.slice(0, 80)}`);
	return Number(m[1]);
}

export function parsePdf(bytes: Uint8Array): ParsedPdf {
	let src = "";
	for (let i = 0; i < bytes.length; i++) src += String.fromCharCode(bytes[i] as number);

	const header = /^%PDF-(1\.\d)\n%[\x80-\xff]{4}\n/.exec(src);
	if (!header) fail("bad header");
	const tail = /startxref\n(\d+)\n%%EOF\n$/.exec(src);
	if (!tail) fail("missing startxref / %%EOF");
	const xrefAt = Number(tail[1]);
	const xrefHead = /^xref\n0 (\d+)\n/.exec(src.slice(xrefAt));
	if (!xrefHead) fail("startxref does not point at an xref table");
	const size = Number(xrefHead[1]);
	const entriesAt = xrefAt + xrefHead[0].length;
	const offsets: number[] = [];
	for (let i = 0; i < size; i++) {
		const entry = src.slice(entriesAt + i * 20, entriesAt + (i + 1) * 20);
		const m = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(entry);
		if (!m) fail(`bad xref entry ${i}: ${JSON.stringify(entry)}`);
		if (i === 0 && (m[3] !== "f" || m[2] !== "65535")) fail("xref entry 0 must be free 65535");
		if (i > 0 && m[3] !== "n") fail(`object ${i} is not in use`);
		offsets.push(Number(m[1]));
	}
	const trailerMatch = /^trailer\n(<<[\s\S]*?>>)\nstartxref\n/.exec(src.slice(entriesAt + size * 20));
	if (!trailerMatch) fail("missing trailer");
	const trailer = trailerMatch[1] as string;
	if (!trailer.includes(`/Size ${size}`)) fail("trailer /Size does not match the xref table");

	const objects = new Map<number, ParsedObject>();
	for (let num = 1; num < size; num++) {
		const at = offsets[num] as number;
		const head = `${num} 0 obj\n`;
		if (src.slice(at, at + head.length) !== head) fail(`xref offset of object ${num} is wrong`);
		const bodyAt = at + head.length;
		const end = src.indexOf("\nendobj\n", bodyAt);
		if (end < 0) fail(`object ${num} has no endobj`);
		const streamKw = src.indexOf(">>\nstream\n", bodyAt);
		if (streamKw >= 0 && streamKw < end) {
			const dict = src.slice(bodyAt, streamKw + 2);
			const len = /\/Length (\d+)/.exec(dict);
			if (!len) fail(`stream ${num} has no /Length`);
			const dataAt = streamKw + ">>\nstream\n".length;
			const data = src.slice(dataAt, dataAt + Number(len[1]));
			const after = src.slice(dataAt + data.length, dataAt + data.length + "\nendstream\nendobj\n".length);
			if (after !== "\nendstream\nendobj\n") fail(`stream ${num} /Length is wrong`);
			objects.set(num, { num, dict, stream: data });
		} else {
			objects.set(num, { num, dict: src.slice(bodyAt, end) });
		}
	}
	const get = (num: number): ParsedObject => objects.get(num) ?? fail(`reference to missing object ${num}`);

	const catalog = get(ref(trailer, "Root"));
	if (!catalog.dict.includes("/Type /Catalog")) fail("root is not a catalog");
	const pagesNum = ref(catalog.dict, "Pages");
	const pagesObj = get(pagesNum);
	if (!pagesObj.dict.includes("/Type /Pages")) fail("catalog /Pages is not a page tree");
	const kids = /\/Kids \[([^\]]*)\]/.exec(pagesObj.dict);
	const count = /\/Count (\d+)/.exec(pagesObj.dict);
	if (!kids || !count) fail("page tree needs /Kids and /Count");
	const kidNums = [...(kids[1] as string).matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
	if (kidNums.length !== Number(count[1])) fail("/Count does not match /Kids");

	const pages = kidNums.map((num): ParsedPage => {
		const page = get(num);
		if (!page.dict.includes("/Type /Page ")) fail(`kid ${num} is not a page`);
		if (ref(page.dict, "Parent") !== pagesNum) fail(`page ${num} has the wrong /Parent`);
		const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(page.dict);
		if (!box) fail(`page ${num} has no /MediaBox`);
		for (const fontRef of page.dict.matchAll(/\/F\d+ (\d+) 0 R/g)) {
			const font = get(Number(fontRef[1]));
			if (!/\/Type \/Font \/Subtype \/Type1 \/BaseFont \/Helvetica/.test(font.dict)) fail("unexpected font object");
		}
		const contents = get(ref(page.dict, "Contents"));
		if (contents.stream === undefined) fail(`page ${num} /Contents is not a stream`);
		return {
			width: Number(box[1]),
			height: Number(box[2]),
			content: contents.stream,
			...parseContent(contents.stream),
		};
	});

	const infoRef = /\/Info (\d+) 0 R/.exec(trailer);
	return {
		version: header[1] as string,
		objects,
		trailer,
		info: infoRef ? get(Number(infoRef[1])).dict : undefined,
		pages,
	};
}

/** Every page's text runs, in order, joined with newlines. */
export function pdfText(pdf: ParsedPdf): string {
	return pdf.pages.map((p) => p.text.map((t) => t.text).join("\n")).join("\n");
}
