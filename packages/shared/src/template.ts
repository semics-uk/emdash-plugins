/**
 * Template rendering and canonical snapshots for e-sign (ES-FR-01, ES-FR-03).
 *
 * `docSha256` is the SHA-256 (lowercase hex) of the UTF-8 bytes of `canonicalSnapshot(rendered)`.
 * Canonical form, in order:
 *   1. strip a leading BOM (U+FEFF)
 *   2. convert CRLF and lone CR to LF
 *   3. Unicode NFC
 *   4. remove trailing spaces and tabs from every line
 *   5. remove all trailing newlines and append exactly one
 * Leading whitespace and blank lines inside the text are significant and kept.
 */

export type TemplateValue = string | number;

export class TemplateError extends Error {
	readonly code = "TEMPLATE_MISSING_FIELD";
	constructor(readonly field: string) {
		super(`Template field "${field}" has no value`);
		this.name = "TemplateError";
	}
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;
const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Escape a value for safe interpolation into Markdown that may also be rendered as HTML. */
export function escapeValue(value: string): string {
	return value
		.replace(/\s*[\r\n]+\s*/g, " ")
		.replace(/[\\&<>"'#[\]()*_`~|{}+!-]/g, (ch) => HTML_ESCAPES[ch] ?? `\\${ch}`);
}

/** Field names a template uses, in first-seen order, without duplicates. */
export function templateFields(template: string): string[] {
	return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1] as string))];
}

/** Fill `{{field}}` placeholders with escaped values. Throws `TemplateError` for a missing field. */
export function renderTemplate(template: string, values: Readonly<Record<string, TemplateValue>>): string {
	return template.replace(PLACEHOLDER, (_all, field: string) => {
		const value = Object.hasOwn(values, field) ? values[field] : undefined;
		if (value === undefined) throw new TemplateError(field);
		return escapeValue(String(value));
	});
}

/** Deterministic text whose SHA-256 is `docSha256`. See the module comment for the exact rules. */
export function canonicalSnapshot(text: string): string {
	const lines = text
		.replace(/^﻿/, "")
		.replace(/\r\n?/g, "\n")
		.normalize("NFC")
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/, ""));
	return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** Lowercase hex SHA-256 of the UTF-8 bytes of `text` (Web Crypto). */
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
