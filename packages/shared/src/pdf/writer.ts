/**
 * Low-level PDF serialisation: numbers, strings and the file frame (header, objects, classic xref
 * table, trailer). Everything is built as a "byte string" (char codes 0-255) and converted once, so
 * offsets are plain string lengths. Nothing here reads a clock or a random source: the same objects
 * always give the same bytes.
 */

const MAX_COORD = 1e7;

/**
 * A number as PDF writes it: at most two decimals, never exponent form, never `-0`; non-finite
 * values become 0 and magnitudes are clamped so they stay in plain notation.
 */
export function num(n: number): string {
	if (!Number.isFinite(n)) return "0";
	const r = Math.round(Math.min(MAX_COORD, Math.max(-MAX_COORD, n)) * 100) / 100;
	return r === 0 ? "0" : String(r);
}

/** A literal string of WinAnsi bytes, with the delimiters escaped. */
export function literal(bytes: string): string {
	return `(${bytes.replace(/[\\()]/g, "\\$&")})`;
}

/**
 * A PDF text string (document information): a literal for printable ASCII, otherwise UTF-16BE hex
 * with a byte-order mark, which every reader decodes.
 */
export function textString(text: string): string {
	if (/^[\x20-\x7e]*$/.test(text)) return literal(text);
	let hex = "FEFF";
	for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
	return `<${hex}>`;
}

/** `D:YYYYMMDDHHmmSSZ` in UTC, or undefined for an invalid date. */
export function pdfDate(date: Date): string | undefined {
	const t = date.getTime();
	if (!Number.isFinite(t)) return undefined;
	const iso = new Date(t).toISOString(); // 2026-10-21T09:16:30.000Z
	return `D:${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** A stream object body (uncompressed, so the output never depends on a compressor). */
export function stream(data: string): string {
	return `<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
}

/**
 * Assemble a complete file. `objects[i]` is the body of object `i + 1`; `root` and `info` are
 * object numbers for the trailer.
 */
export function serialize(objects: string[], root: number, info?: number): Uint8Array<ArrayBuffer> {
	const parts: string[] = ["%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"];
	let offset = (parts[0] as string).length;
	let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	objects.forEach((body, i) => {
		const obj = `${i + 1} 0 obj\n${body}\nendobj\n`;
		xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
		parts.push(obj);
		offset += obj.length;
	});
	const infoRef = info === undefined ? "" : ` /Info ${info} 0 R`;
	parts.push(
		`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R${infoRef} >>\nstartxref\n${offset}\n%%EOF\n`,
	);
	const file = parts.join("");
	const out = new Uint8Array(file.length);
	for (let i = 0; i < file.length; i++) out[i] = file.charCodeAt(i);
	return out;
}
