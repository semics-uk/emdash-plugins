/**
 * CSV for the attendee export (EV-FR-11). Pure.
 *
 * Cells are quoted when they hold a comma, quote or line break (quotes doubled). A text cell that
 * starts with `=`, `+`, `-`, `@`, tab or carriage return would run as a formula in a spreadsheet,
 * so it gets a leading apostrophe. Numbers are written as they are: a real `-5` is not a formula.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	let text = String(value);
	if (FORMULA_START.test(text)) text = `'${text}`;
	return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Header and rows joined with CRLF (RFC 4180), ending with a line break. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
	return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
