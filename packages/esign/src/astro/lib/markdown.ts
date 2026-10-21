/**
 * The snapshot renderer's sanitiser (SU-FR-03, SU-NFR-01). A snapshot is sender-written,
 * Markdown-ish template text whose `{{field}}` values were escaped by shared `renderTemplate`
 * (`&<>"'` as entities, Markdown punctuation with a backslash). It is what `docSha256` covers, so
 * it is shown as it is, never rewritten.
 *
 * Rather than producing HTML and cleaning it, this parses the text into a tree of a few allowed
 * node kinds (headings, paragraphs, lists, quotes, code, rules; strong, emphasis, code spans, line
 * breaks, links) holding plain strings. The Astro components render the tree through `{text}`
 * interpolation, which escapes, so raw HTML in the text can only ever show up as text. The only
 * attribute that comes from the text is a link's `href`, and only an absolute http(s) or mailto
 * URL passes `safeHref`; anything else, images included, stays literal text. Work is linear in the
 * input: failed delimiter searches are remembered and nesting is capped.
 */

export type Inline =
	| { type: "text"; text: string }
	| { type: "strong"; children: Inline[] }
	| { type: "em"; children: Inline[] }
	| { type: "code"; text: string }
	| { type: "link"; href: string; children: Inline[] }
	| { type: "break" };

export type Block =
	| { type: "heading"; level: 2 | 3 | 4 | 5 | 6; children: Inline[] }
	| { type: "paragraph"; children: Inline[] }
	| { type: "list"; ordered: boolean; start?: number; items: Inline[][] }
	| { type: "quote"; children: Block[] }
	| { type: "code"; text: string }
	| { type: "rule" };

const MAX_INLINE_DEPTH = 6;
const MAX_QUOTE_DEPTH = 4;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const ENTITY = /^&(amp|lt|gt|quot|#39);/;
const PUNCT = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters never belong in a link.
const UNSAFE_URL_CHARS = /[\s"'<>`\\\u0000-\u001F\u007F]/;
const SAFE_URL_START = /^(https?:\/\/|mailto:)/i;

/** An absolute http, https or mailto URL, normalised; anything else is `undefined`. */
export function safeHref(raw: string): string | undefined {
	if (raw.length === 0 || UNSAFE_URL_CHARS.test(raw) || !SAFE_URL_START.test(raw)) return undefined;
	try {
		// The scheme is the checked prefix, so the parsed protocol is http:, https: or mailto:.
		return new URL(raw).href;
	} catch {
		return undefined;
	}
}

/** Undoes `escapeValue`: the five entities it writes and backslash-escaped punctuation. */
export function decodeText(text: string): string {
	return text.replace(/\\([!-/:-@[-`{-~])|&(amp|lt|gt|quot|#39);/g, (_all, punct?: string, entity?: string) =>
		punct !== undefined ? punct : (ENTITIES[entity as string] as string),
	);
}

// --- inline ---

type Found = { inline?: Inline; text?: string; end: number };

/** Index of the partner of every bracket (stack matching, escapes honoured), for `[]` and `()`. */
function pairs(src: string): Map<number, number> {
	const out = new Map<number, number>();
	const stacks: Record<string, number[]> = { "]": [], ")": [] };
	const openerOf: Record<string, string> = { "[": "]", "(": ")" };
	for (let j = 0; j < src.length; j++) {
		const c = src[j] as string;
		if (c === "\\") j++;
		else if (c in openerOf) stacks[openerOf[c] as string]?.push(j);
		else if (c === "]" || c === ")") {
			const open = stacks[c]?.pop();
			if (open !== undefined) out.set(open, j);
		}
	}
	return out;
}

class InlineParser {
	private readonly partner: Map<number, number>;
	/** Per closer kind, the last search: closers do not depend on their opener, so it can be reused. */
	private readonly memo = new Map<string, { from: number; at: number }>();

	constructor(private readonly src: string) {
		this.partner = pairs(src);
	}

	parse(from: number, to: number, depth: number): Inline[] {
		const { src } = this;
		const out: Inline[] = [];
		let buf = "";
		const flush = () => {
			if (buf) out.push({ type: "text", text: buf });
			buf = "";
		};
		let i = from;
		while (i < to) {
			const ch = src[i] as string;
			if (ch === "\\" && i + 1 < to && PUNCT.test(src[i + 1] as string)) {
				buf += src[i + 1];
				i += 2;
				continue;
			}
			const entity = ch === "&" ? ENTITY.exec(src.slice(i, Math.min(to, i + 6))) : null;
			if (entity) {
				buf += ENTITIES[entity[1] as string];
				i += entity[0].length;
				continue;
			}
			if (ch === "\n") {
				flush();
				out.push({ type: "break" });
				i++;
				continue;
			}
			const found = depth < MAX_INLINE_DEPTH ? this.markup(i, to, depth) : undefined;
			if (found?.inline) {
				flush();
				out.push(found.inline);
			} else buf += found ? found.text : ch;
			i = found ? found.end : i + 1;
		}
		flush();
		return out;
	}

	/** The markup starting at `i`, if any: a node, or literal text to keep (an image's alt text). */
	private markup(i: number, to: number, depth: number): Found | undefined {
		const ch = this.src[i];
		if (ch === "`") return this.codeSpan(i, to);
		if (ch === "*" || ch === "_") return this.emphasis(i, to, depth);
		if (ch === "[") return this.link(i, to, depth, false);
		if (ch === "!" && this.src[i + 1] === "[") return this.link(i + 1, to, depth, true);
		if (ch === "<") return this.autolink(i, to);
		return undefined;
	}

	/**
	 * The first index at or after `from` where `valid` holds, or -1. `valid` must not depend on the
	 * opener, so a search for the same `key` from inside the last answered range has the same answer.
	 */
	private next(key: string, from: number, step: (at: number) => number, valid: (at: number) => boolean): number {
		const last = this.memo.get(key);
		if (last && from >= last.from && (last.at === -1 || from <= last.at)) return last.at;
		let at = step(from);
		while (at !== -1 && !valid(at)) at = step(at + 1);
		this.memo.set(key, { from, at });
		return at;
	}

	private escaped(at: number): boolean {
		let slashes = 0;
		for (let j = at - 1; j >= 0 && this.src[j] === "\\"; j--) slashes++;
		return slashes % 2 === 1;
	}

	private codeSpan(i: number, to: number): Found {
		const { src } = this;
		let n = 1;
		while (src[i + n] === "`") n++;
		const fence = "`".repeat(n);
		// A closer is a run of exactly n backticks.
		const close = this.next(
			`code${n}`,
			i + n,
			(at) => src.indexOf(fence, at),
			(at) => src[at - 1] !== "`" && src[at + n] !== "`",
		);
		if (close === -1 || close + n > to) return { text: fence, end: i + n };
		return { inline: { type: "code", text: decodeText(src.slice(i + n, close)) }, end: close + n };
	}

	private emphasis(i: number, to: number, depth: number): Found {
		const { src } = this;
		const ch = src[i] as string;
		const delim = src[i + 1] === ch ? ch + ch : ch;
		const start = i + delim.length;
		const word = (at: number) => at >= 0 && at < src.length && WORD.test(src[at] as string);
		const intraword = (at: number) => ch === "_" && word(at);
		const literal = { text: delim, end: start };
		if (intraword(i - 1) || start >= to || /\s/.test(src[start] as string)) return literal;
		const close = this.next(
			delim,
			start + 1,
			(at) => src.indexOf(delim, at),
			(at) => !this.escaped(at) && !/\s/.test(src[at - 1] as string) && !intraword(at + delim.length),
		);
		if (close === -1 || close + delim.length > to) return literal;
		const children = this.parse(start, close, depth + 1);
		return { inline: { type: delim.length === 2 ? "strong" : "em", children }, end: close + delim.length };
	}

	/** `[text](url)`; with `image`, `![alt](url)`, of which only the alt text is shown. */
	private link(i: number, to: number, depth: number, image: boolean): Found {
		const { src } = this;
		const literal = { text: image ? "![" : "[", end: i + 1 };
		const closeText = this.partner.get(i);
		if (closeText === undefined || closeText >= to || src[closeText + 1] !== "(") return literal;
		const closeUrl = this.partner.get(closeText + 1);
		if (closeUrl === undefined || closeUrl >= to) return literal;
		const end = closeUrl + 1;
		if (image) return { text: decodeText(src.slice(i + 1, closeText)), end };
		const href = safeHref(decodeText(src.slice(closeText + 2, closeUrl)));
		if (!href) return { text: decodeText(src.slice(i, end)), end };
		return { inline: { type: "link", href, children: this.parse(i + 1, closeText, depth + 1) }, end };
	}

	private autolink(i: number, to: number): Found | undefined {
		const match = /^<([A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*)>/.exec(this.src.slice(i, Math.min(to, i + 2048)));
		const href = match ? safeHref(match[1] as string) : undefined;
		if (!match || !href) return undefined;
		return {
			inline: { type: "link", href, children: [{ type: "text", text: match[1] as string }] },
			end: i + match[0].length,
		};
	}
}

function inline(text: string): Inline[] {
	return new InlineParser(text).parse(0, text.length, 0);
}

// --- blocks ---

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/;
const ORDERED = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/;

const blank = (line: string) => line.trim() === "";
const startsBlock = (line: string) =>
	FENCE.test(line) ||
	HEADING.test(line) ||
	RULE.test(line) ||
	QUOTE.test(line) ||
	BULLET.test(line) ||
	ORDERED.test(line);

function blocks(lines: string[], depth: number): Block[] {
	const out: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] as string;
		if (blank(line)) {
			i++;
			continue;
		}
		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[1] as string;
			const closer = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
			const body: string[] = [];
			i++;
			while (i < lines.length && !closer.test(lines[i] as string)) {
				body.push(lines[i] as string);
				i++;
			}
			i++;
			out.push({ type: "code", text: decodeText(body.join("\n")) });
			continue;
		}
		if (RULE.test(line)) {
			out.push({ type: "rule" });
			i++;
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			const level = Math.min(6, (heading[1] as string).length + 1) as 2 | 3 | 4 | 5 | 6;
			out.push({ type: "heading", level, children: inline(heading[2] ?? "") });
			i++;
			continue;
		}
		if (QUOTE.test(line) && depth < MAX_QUOTE_DEPTH) {
			const inner: string[] = [];
			while (i < lines.length && QUOTE.test(lines[i] as string)) {
				inner.push((QUOTE.exec(lines[i] as string) as RegExpExecArray)[1] as string);
				i++;
			}
			out.push({ type: "quote", children: blocks(inner, depth + 1) });
			continue;
		}
		const bullet = BULLET.test(line);
		const ordered = ORDERED.exec(line);
		if (bullet || ordered) {
			const pattern = bullet ? BULLET : ORDERED;
			const items: string[][] = [];
			while (i < lines.length) {
				const current = lines[i] as string;
				const item = pattern.exec(current);
				if (item) items.push([(bullet ? item[1] : item[2]) as string]);
				else if (!blank(current) && /^ {2,}\S/.test(current) && !startsBlock(current.trimStart())) {
					(items.at(-1) as string[]).push(current.trim());
				} else break;
				i++;
			}
			out.push({
				type: "list",
				ordered: !bullet,
				...(ordered && ordered[1] !== "1" ? { start: Number(ordered[1]) } : {}),
				items: items.map((item) => inline(item.join("\n"))),
			});
			continue;
		}
		const para: string[] = [line.trim()];
		i++;
		while (i < lines.length && !blank(lines[i] as string) && !startsBlock(lines[i] as string)) {
			para.push((lines[i] as string).trim());
			i++;
		}
		out.push({ type: "paragraph", children: inline(para.join("\n")) });
	}
	return out;
}

/** The snapshot as a tree of allowed nodes. Line endings are normalised; nothing else is changed. */
export function parseSnapshot(text: string): Block[] {
	return blocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}

/** The visible text of a tree (blocks separated by blank lines, breaks as newlines). */
export function textOf(tree: Block[]): string {
	const ofInline = (nodes: Inline[]): string =>
		nodes
			.map((n) => (n.type === "text" || n.type === "code" ? n.text : n.type === "break" ? "\n" : ofInline(n.children)))
			.join("");
	return tree
		.map((b) => {
			switch (b.type) {
				case "quote":
					return textOf(b.children);
				case "list":
					return b.items.map(ofInline).join("\n");
				case "code":
					return b.text;
				case "rule":
					return "";
				default:
					return ofInline(b.children);
			}
		})
		.join("\n\n");
}
