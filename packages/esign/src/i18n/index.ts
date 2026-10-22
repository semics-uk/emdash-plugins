/**
 * Translations of the E-sign UI kit (T102, SU-NFR-06). The UI half only: the sandboxed core answers with
 * codes (`SIGNING_TOKEN_EXPIRED`, ...) and never ships a message table (R51, R58). Components take a
 * `locale` (prop, else `Astro.currentLocale`, the page's locale when the site configures Astro i18n, else
 * `en-GB`); its language picks the table here, falling back to English, and its direction sets `dir` on
 * each component. A copy of the Events kit's module (packages never import each other, R35).
 *
 * Client scripts carry no text: the page renders the messages a script needs into a `data-messages`
 * attribute (`clientMessages`). Adding a language: `docs/i18n.md`.
 */
import { ar } from "./ar.ts";
import { en, type MessageKey } from "./en.ts";

export type { MessageKey };

/** Extra plural forms a language may need beyond English's `one` and `other`. */
type PluralForm = "zero" | "two" | "few" | "many";

/** A language's table: every English key, plus any extra plural forms. */
export type Messages = { [K in MessageKey]: string } & { [extra: `${string}.${PluralForm}`]: string };

/** A key with plural forms, named without its `.one` / `.other` suffix. */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer Base}.other` ? Base : never) : never;

export type Vars = Record<string, string | number>;

/** The languages the kit ships, by BCP 47 language subtag. */
export const LANGUAGES: Record<string, Messages> = { en, ar };

/** Languages written right to left (whether or not a table ships for them yet). */
const RTL = new Set(["ar", "dv", "fa", "he", "ku", "ps", "sd", "ug", "ur", "yi"]);

/** The table's language for a locale (`ar-EG` -> `ar`); English when there is no table for it. */
export function languageOf(locale?: string | null): string {
	const base = (locale ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
	return Object.hasOwn(LANGUAGES, base) ? base : "en";
}

/** The writing direction of what a locale's page shows (English text for an unknown language). */
export function directionOf(locale?: string | null): "ltr" | "rtl" {
	return RTL.has(languageOf(locale)) ? "rtl" : "ltr";
}

/** `{name}` placeholders filled from `vars`; unknown ones are left as they are. */
export function fill(text: string, vars?: Vars): string {
	return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}

export interface Translator {
	/** The table's language (`en`, `ar`): the value for `lang` attributes. */
	lang: string;
	dir: "ltr" | "rtl";
	t(key: MessageKey, vars?: Vars): string;
	/** The plural form of `key` for `count` by the language's rules (`count` is also a placeholder). */
	plural(key: PluralKey, count: number, vars?: Vars): string;
}

const tables = LANGUAGES as Record<string, Record<string, string>>;

export function translator(locale?: string | null): Translator {
	const lang = languageOf(locale);
	const table = tables[lang] ?? tables.en;
	const lookup = (key: string) => table?.[key] ?? tables.en?.[key] ?? key;
	const rules = new Intl.PluralRules(lang);
	return {
		lang,
		dir: directionOf(lang),
		t: (key, vars) => fill(lookup(key), vars),
		plural: (key, count, vars) => {
			const form = `${key}.${rules.select(count)}`;
			const text = table && Object.hasOwn(table, form) ? (table[form] as string) : lookup(`${key}.other`);
			return fill(text, { count: new Intl.NumberFormat(lang).format(count), ...vars });
		},
	};
}

/** One message in a locale's language (English fallback). */
export function t(locale: string | null | undefined, key: MessageKey, vars?: Vars): string {
	return translator(locale).t(key, vars);
}

/**
 * The messages under `prefix` (the prefix dropped), plus every key under each of `more` (kept whole), for a
 * client script's `data-messages` attribute.
 */
export function clientMessages(
	locale: string | null | undefined,
	prefix: string,
	...more: string[]
): Record<string, string> {
	const table = tables[languageOf(locale)] ?? {};
	const out: Record<string, string> = {};
	for (const key of Object.keys(en)) {
		const text = table[key] ?? (en as Record<string, string>)[key] ?? "";
		if (key.startsWith(prefix)) out[key.slice(prefix.length)] = text;
		else if (more.some((p) => key.startsWith(p))) out[key] = text;
	}
	return out;
}

/** The first locale given (a prop, `Astro.currentLocale`, the integration's option), else `en-GB`. */
export function pickLocale(...candidates: Array<string | null | undefined>): string {
	return candidates.find((c): c is string => typeof c === "string" && c.trim() !== "") ?? "en-GB";
}

/**
 * A message as text runs and the `{placeholders}` left in it, so a component can put an element (a link,
 * `<strong>`) where the language puts the placeholder: `{segments(t(key)).map((s) => s.slot === "name" ? <b/> : s.text)}`.
 */
export function segments(text: string): Array<{ text: string; slot?: string }> {
	return text
		.split(/(\{\w+\})/)
		.filter((part) => part !== "")
		.map((part) => (/^\{\w+\}$/.test(part) ? { text: "", slot: part.slice(1, -1) } : { text: part }));
}

/** A message split around one `{placeholder}`, so a component can put an element (a `<time>`) there. */
export function around(text: string, name: string): [string, string] {
	const at = text.indexOf(`{${name}}`);
	return at === -1 ? [text, ""] : [text.slice(0, at), text.slice(at + name.length + 2)];
}
