import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// T102 (EU-NFR-04, SU-NFR-06): every user-facing string of the Events and E-sign UI kits comes from the
// package's `src/i18n` tables, and their layouts work right to left. This lint finds text written straight
// into a component, a UI helper or a client script, and CSS that names a physical side (left/right) where a
// logical property (inline-start/end) keeps right-to-left pages correct.
//
// A string is "text" when it reads like words for people: it has a space between words that are not all
// class-name style identifiers, a capitalised word, or sentence punctuation. A technical string (an HTTP
// header, a log message for developers) is exempted by `// i18n-ignore` on its line or the line above.
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PACKAGES = ["events", "esign"];
const DIRS = ["src/astro", "src/client"];

function files(dir) {
	let out = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of entries) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out = out.concat(files(path));
		else if (/\.(ts|js|astro)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
	}
	return out;
}

const IDENT = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;
const TECHNICAL_WORD = /^[A-Za-z0-9_$.:/#?=&%@*+,;[\]^|~-]*$/;

/** Whether a string literal (or the static part of a template) reads as words for people. */
export function looksLikeText(value) {
	const trimmed = value.trim();
	if (!/\p{L}{2,}/u.test(trimmed)) return false;
	// CSS (the e-sign page's hashed stylesheets) is checked by the CSS rule instead.
	if (/[{}]/.test(trimmed) && /:[^;]*;/.test(trimmed)) return false;
	if (/\s/.test(trimmed)) return !trimmed.split(/\s+/).every((t) => IDENT.test(t));
	if (trimmed !== value && /\p{L}/u.test(value)) return true; // " or ", "From "
	if (/^\p{Lu}\p{Ll}+$/u.test(trimmed)) return true; // "Free", "Undo"
	if (/[\p{L}]/u.test(trimmed) && !/^[\x20-\x7e]*$/.test(trimmed)) return true; // non-ASCII words
	return !TECHNICAL_WORD.test(trimmed);
}

/** The string literals of JavaScript source (comments skipped), with their line numbers. */
export function jsStrings(src) {
	const out = [];
	let i = 0;
	let line = 1;
	let prev = "";
	const regexAfter = /[(,=:[!&|?{};+\-*%<>~^]|^$/;
	while (i < src.length) {
		const c = src[i];
		if (c === "\n") {
			line++;
			i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2);
			const stop = end === -1 ? src.length : end + 2;
			line += (src.slice(i, stop).match(/\n/g) ?? []).length;
			i = stop;
			continue;
		}
		if (c === "/" && regexAfter.test(prev)) {
			// A regular expression literal: skip it (classes may hold quotes).
			let j = i + 1;
			let inClass = false;
			while (j < src.length && src[j] !== "\n") {
				if (src[j] === "\\") j += 2;
				else if (src[j] === "[" || src[j] === "]") {
					inClass = src[j] === "[";
					j++;
				} else if (src[j] === "/" && !inClass) break;
				else j++;
			}
			i = j + 1;
			prev = "/";
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			const start = line;
			let j = i + 1;
			let value = "";
			let depth = 0;
			while (j < src.length) {
				const d = src[j];
				if (d === "\\") {
					value += src[j + 1] ?? "";
					j += 2;
					continue;
				}
				if (d === "\n") line++;
				if (c === "`" && d === "$" && src[j + 1] === "{" && depth === 0) {
					// The static parts of a template, with a placeholder for each expression.
					depth = 1;
					j += 2;
					value += "\u0000";
					while (j < src.length && depth > 0) {
						if (src[j] === "{") depth++;
						else if (src[j] === "}") depth--;
						else if (src[j] === "\n") line++;
						j++;
					}
					continue;
				}
				if (d === c) break;
				value += d;
				j++;
			}
			for (const part of value.split("\u0000")) out.push({ value: part, line: start, whole: value });
			i = j + 1;
			prev = "a";
			continue;
		}
		if (!/\s/.test(c)) prev = c;
		i++;
	}
	return out;
}

/** Removes balanced `{…}` groups (and anything after an unclosed `{` or before a stray `}`). */
function withoutExpressions(text) {
	let out = "";
	let depth = 0;
	for (const c of text) {
		if (c === "{") depth++;
		else if (c === "}") {
			if (depth === 0) out = "";
			else depth--;
		} else if (depth === 0) out += c;
	}
	return out;
}

/** The balanced `{…}` expressions of an Astro template, with the line each starts on. */
function templateExpressions(template, offsetLine) {
	const out = [];
	let depth = 0;
	let start = 0;
	let line = offsetLine;
	let startLine = line;
	for (let i = 0; i < template.length; i++) {
		const c = template[i];
		if (c === "\n") line++;
		if (c === "{") {
			if (depth === 0) {
				start = i + 1;
				startLine = line;
			}
			depth++;
		} else if (c === "}" && depth > 0) {
			depth--;
			if (depth === 0) out.push({ code: template.slice(start, i), line: startLine });
		}
	}
	return out;
}

const blank = (s) => s.replace(/[^\n]/g, " ");

/** Violations in one Astro component: text nodes, text-like attributes, literals in its script and template. */
export function astroViolations(src) {
	const found = [];
	const fm = /^---\n([\s\S]*?)\n---/.exec(src);
	const frontmatter = fm ? fm[1] : "";
	let template = fm ? blank(src.slice(0, fm[0].length)) + src.slice(fm[0].length) : src;
	template = template
		.replace(/<style[\s\S]*?<\/style>/g, blank)
		.replace(/<script[\s\S]*?<\/script>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, blank);
	const lines = src.split("\n");
	const ignored = (line) =>
		/i18n-ignore|headers\.set\(/.test(lines[line - 1] ?? "") || /i18n-ignore/.test(lines[line - 2] ?? "");
	for (const s of jsStrings(frontmatter)) {
		if (looksLikeText(s.value) && !ignored(s.line + 1)) found.push({ line: s.line + 1, text: s.whole });
	}
	// Text between tags.
	const textNode = />([^<>]*)</g;
	for (let m = textNode.exec(template); m; m = textNode.exec(template)) {
		const raw = withoutExpressions(m[1]).trim();
		// Code between the JSX of an expression (`) : booking ? (`), not a text node.
		if (/^\)|\($|&&$|\|\|$|=>/.test(raw)) continue;
		const text = raw.replace(/[()?:&|!;,]/g, " ");
		const line = template.slice(0, m.index).split("\n").length;
		if (/\p{L}{2,}/u.test(text) && !ignored(line)) found.push({ line, text: text.trim() });
	}
	// Quoted attribute values people read.
	const attr = /\s(aria-label|aria-description|title|alt|placeholder|label|data-message|data-label)="([^"]*)"/g;
	for (let m = attr.exec(template); m; m = attr.exec(template)) {
		const line = template.slice(0, m.index).split("\n").length;
		if (/\p{L}{2,}/u.test(m[2]) && !ignored(line)) found.push({ line, text: `${m[1]}="${m[2]}"` });
	}
	// String literals inside template expressions.
	for (const expr of templateExpressions(template, 1)) {
		for (const s of jsStrings(expr.code)) {
			const line = expr.line + s.line - 1;
			if (looksLikeText(s.value) && !ignored(line)) found.push({ line, text: s.whole });
		}
	}
	return found;
}

/** Violations in a TypeScript or JavaScript module. */
export function scriptViolations(src) {
	const lines = src.split("\n");
	const ignored = (line) =>
		/i18n-ignore|headers\.set\(/.test(lines[line - 1] ?? "") || /i18n-ignore/.test(lines[line - 2] ?? "");
	return jsStrings(src)
		.filter((s) => !/^\s*(import|export .* from)\b/.test(lines[s.line - 1] ?? ""))
		.filter((s) => looksLikeText(s.value) && !ignored(s.line))
		.map((s) => ({ line: s.line, text: s.whole }));
}

const PHYSICAL =
	/(?:^|[\s;{"])((?:margin|padding|border|inset|scroll-margin|scroll-padding)-(?:left|right)(?:-[a-z]+)?|border-(?:top|bottom)-(?:left|right)-radius|left|right|float:\s*(?:left|right)|clear:\s*(?:left|right)|text-align:\s*(?:left|right))\s*:/gm;

/** CSS declarations naming a physical side, in `<style>` blocks, `style=""` attributes and CSS strings. */
export function cssViolations(src) {
	const found = [];
	const lines = src.split("\n");
	for (let n = 0; n < lines.length; n++) {
		const text = lines[n];
		if (/i18n-ignore/.test(text)) continue;
		// Only CSS: skip lines that are plainly script (property access such as `rect.left`).
		if (!/[;:{]/.test(text) || /\b(?:const|let|return|function|=>)\b|\.\s*(?:left|right)\b/.test(text)) continue;
		PHYSICAL.lastIndex = 0;
		for (let m = PHYSICAL.exec(text); m; m = PHYSICAL.exec(text)) found.push({ line: n + 1, text: m[1] });
	}
	return found;
}

for (const pkg of PACKAGES) {
	const scanned = DIRS.flatMap((dir) => files(join(repoRoot, "packages", pkg, dir)));

	test(`${pkg} UI has no hard-coded user-facing strings`, () => {
		assert.ok(scanned.length > 0, `no UI sources found in packages/${pkg}`);
		const offenders = [];
		for (const path of scanned) {
			const src = readFileSync(path, "utf8");
			const hits = path.endsWith(".astro") ? astroViolations(src) : scriptViolations(src);
			for (const hit of hits) offenders.push(`${relative(repoRoot, path)}:${hit.line} ${JSON.stringify(hit.text)}`);
		}
		assert.deepEqual(offenders, []);
	});

	test(`${pkg} UI styles use logical sides (right-to-left layouts)`, () => {
		const offenders = [];
		for (const path of scanned) {
			const src = readFileSync(path, "utf8");
			const styles = path.endsWith(".astro")
				? [...src.matchAll(/<style[\s\S]*?<\/style>|style="[^"]*"/g)].map((m) => m[0]).join("\n")
				: [...src.matchAll(/`[^`]*`/g)].map((m) => m[0]).join("\n");
			for (const hit of cssViolations(styles)) offenders.push(`${relative(repoRoot, path)} ${hit.text}`);
		}
		assert.deepEqual(offenders, []);
	});

	test(`${pkg} pages set lang and dir from the locale`, () => {
		const pages = scanned.filter((path) => path.endsWith(".astro") && /<html\b/.test(readFileSync(path, "utf8")));
		assert.ok(pages.length > 0);
		const offenders = pages.filter(
			(path) => !/<html\s+lang=\{[^}]+\}\s+dir=\{[^}]+\}/.test(readFileSync(path, "utf8")),
		);
		assert.deepEqual(
			offenders.map((path) => relative(repoRoot, path)),
			[],
		);
	});
}

test("the lint tells text from technical strings", () => {
	for (const text of ["Book tickets", "Free", " or ", "From ", "Sold out", "(sold out)", "Check-in code", "حجز"])
		assert.equal(looksLikeText(text), true, text);
	for (const tech of [
		"semics-field semics-check",
		"esign-code-hint esign-error",
		"NOT_FOUND",
		"en-GB",
		"2-digit",
		"Referrer-Policy",
		"/_events/checkout",
		"content-type",
		"",
		"h",
	])
		assert.equal(looksLikeText(tech), false, tech);
	assert.deepEqual(
		astroViolations('---\nconst a = "Hello there";\n---\n<p>Hi {name}</p>\n<p>{x ? " (sold out)" : ""}</p>').map(
			(v) => v.text,
		),
		["Hello there", "Hi", " (sold out)"],
	);
	assert.deepEqual(
		cssViolations(".a { margin-left: 1px; inset-inline-start: 0; }").map((v) => v.text),
		["margin-left"],
	);
});
