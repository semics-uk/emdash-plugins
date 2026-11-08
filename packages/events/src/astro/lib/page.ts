// i18n-ignore-file: a stylesheet and its option names, no text for people.
/**
 * The look of the plugins' own full pages (`/booking`, the suite's `/_events/waiver`), which run outside the
 * site's layout: a default stylesheet built only on the `--events-*` properties, and what a site sets through
 * `eventsIntegration({ page })` / `eventsSuite({ page })`. It is one exact string so the signing page can allow
 * it by hash (its CSP allows nothing else inline, `ceremonyCsp`). Web APIs only (R35).
 *
 * The site's own layout is deliberately not wrapped around these pages: an emailed link's one-time code is in the
 * URL here, and a signing page's CSP would block the layout's scripts and styles anyway.
 */

/** A theme value by property: `accent` sets `--events-accent` (the signing form follows, see `PAGE_CSS`). */
export const THEME_PROPERTIES = [
	"fg",
	"muted",
	"bg",
	"border",
	"accent",
	"accent-fg",
	"error",
	"success",
	"radius",
	"font",
	"page-bg",
	"heading-font",
	"heading-fg",
] as const;
export type ThemeProperty = (typeof THEME_PROPERTIES)[number];
export interface PageBrand {
	/** The site's name: the link's text, or the logo's alternative text. Also the organiser at the page's foot. */
	name: string;
	/** Where it links, a path on this site (default `/`). */
	href?: string;
	/** A logo, a path on this site. */
	logo?: string;
	/** The organiser's postal address, one line, at the page's foot and on a printed booking (T157). */
	address?: string;
}

/** One line of text for people: 1 to 300 characters, no control characters (line breaks included). */
function oneLine(value: unknown): boolean {
	if (typeof value !== "string" || !value.trim() || value.length > 300) return false;
	for (let i = 0; i < value.length; i++) {
		const unit = value.charCodeAt(i);
		if (unit <= 0x1f || unit === 0x7f) return false;
	}
	return true;
}

export interface PageOptions {
	/** Values for the pages' custom properties, for example `{ accent: "#1f3a2e", "page-bg": "#f6f1ea" }`. */
	theme?: Partial<Record<ThemeProperty, string>>;
	/** A stylesheet on this site, loaded after the defaults: for `@font-face`, or any further rules. */
	stylesheet?: string;
	/** The site's name or logo at the top of each page. */
	brand?: PageBrand;
	/** The event's page, where "Book again" goes: a path with `{slug}` (default `/events/{slug}`). */
	eventPath?: string;
}

/** One line of CSS, nothing that could end the declaration, the rule or the `<style>` element. */
const THEME_VALUE = /^[^;{}<>\\@]{1,200}$/;
/** A path on this site; `;` and `,` would end a source in the signing page's CSP header. */
const SITE_PATH = /^\/(?!\/)[^\s"'<>\\;,]*$/;

/** Checks a site's page options when the site's config loads; a bad value stops the build with its name. */
export function checkPageOptions(page: PageOptions = {}): PageOptions {
	const refuse = (what: string) => {
		throw new Error(`page.${what} is not valid`); // i18n-ignore
	};
	for (const [name, value] of Object.entries(page.theme ?? {})) {
		const known = (THEME_PROPERTIES as readonly string[]).includes(name);
		if (!known || typeof value !== "string" || !THEME_VALUE.test(value) || /url\(/i.test(value))
			refuse(`theme.${name}`);
	}
	const { brand, stylesheet, eventPath } = page;
	if (stylesheet !== undefined && !SITE_PATH.test(stylesheet)) refuse("stylesheet");
	if (eventPath !== undefined && !(SITE_PATH.test(eventPath) && eventPath.includes("{slug}"))) refuse("eventPath");
	if (brand) {
		if (typeof brand.name !== "string" || !brand.name.trim()) refuse("brand.name");
		if (brand.href !== undefined && !SITE_PATH.test(brand.href)) refuse("brand.href");
		if (brand.logo !== undefined && !SITE_PATH.test(brand.logo)) refuse("brand.logo");
		if (brand.address !== undefined && !oneLine(brand.address)) refuse("brand.address");
	}
	return page;
}

/** The event's page for "Book again"; undefined when the booking does not know its slug. */
export function eventPageHref(slug: string | null | undefined, eventPath?: string): string | undefined {
	return slug ? (eventPath ?? "/events/{slug}").replace("{slug}", encodeURIComponent(slug)) : undefined;
}

/** Works with no site theme at all. Zero specificity on elements, so the components' own rules win. */
export const PAGE_CSS = `*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light;-webkit-text-size-adjust:100%}
body.semics-page{margin:0;min-block-size:100vh;background:var(--events-page-bg, #f5f4f0);color:var(--events-fg, #1a1a1a);font-family:var(--events-font, system-ui, sans-serif);font-size:1.0625rem;line-height:1.55;overflow-wrap:anywhere;
--esign-fg:var(--events-fg, #1a1a1a);--esign-muted:var(--events-muted, #4a4a4a);--esign-bg:var(--events-bg, #ffffff);--esign-border:var(--events-border, #6b6b6b);--esign-accent:var(--events-accent, #0b57d0);--esign-accent-fg:var(--events-accent-fg, #ffffff);--esign-error:var(--events-error, #b3261e);--esign-radius:var(--events-radius, 6px);--esign-font:var(--events-font, system-ui, sans-serif)}
.semics-page-brand{max-inline-size:40rem;margin-inline:auto;padding:1.25rem 1rem 0;font-family:var(--events-heading-font, inherit);font-weight:600}
.semics-page-brand a{color:var(--events-heading-fg, inherit);text-decoration:none}
.semics-page-brand img{display:block;block-size:2.5rem;inline-size:auto;max-inline-size:100%}
.semics-page-main{max-inline-size:40rem;margin-inline:auto;padding:1.5rem 1rem 2rem}
:where(.semics-page) :is(h1,h2,h3){margin:0 0 .75rem;font-family:var(--events-heading-font, inherit);color:var(--events-heading-fg, inherit);line-height:1.2}
:where(.semics-page) h1{margin-block-end:1.25rem;font-size:clamp(1.75rem,1.5rem + 1.5vw,2.25rem)}
:where(.semics-page) h2{font-size:1.25rem}
:where(.semics-page) h3{font-size:1.0625rem}
:where(.semics-page) p{margin:0 0 .75rem}
:where(.semics-page) a{color:var(--events-accent, #0b57d0);text-underline-offset:.2em}
:where(.semics-page) :focus-visible{outline:3px solid var(--events-accent, #0b57d0);outline-offset:2px}
:where(.semics-page-main > section,.semics-page-main > form:not([hidden]),.semics-page-main > .semics-ceremony){margin-block:0 1.25rem;padding:clamp(1.25rem,.9rem + 1.8vw,1.75rem);background:var(--events-bg, #ffffff);border:1px solid color-mix(in srgb,var(--events-border, #6b6b6b) 30%,transparent);border-radius:calc(var(--events-radius, 6px) + 6px);box-shadow:0 1px 2px rgb(0 0 0 / .04),0 6px 24px rgb(0 0 0 / .05);max-inline-size:none}
:where(.semics-page-main > section,.semics-page-main > form,.semics-page-main > .semics-ceremony) > :last-child{margin-block-end:0}
:where(.semics-page) [role="alert"]{padding:.75rem 1rem;border:1px solid var(--events-error, #b3261e);border-radius:var(--events-radius, 6px);background:var(--events-bg, #ffffff);color:var(--events-error, #b3261e)}
:where(.semics-page) :is(input:not([type="checkbox"],[type="radio"],[type="hidden"]),select,textarea){font:inherit;inline-size:100%;min-block-size:2.75rem;padding:.5rem .75rem;border:1px solid var(--events-border, #6b6b6b);border-radius:var(--events-radius, 6px);background:var(--events-bg, #ffffff);color:var(--events-fg, #1a1a1a)}
:where(.semics-page) label{display:block}
:where(.semics-page) fieldset{min-inline-size:0;margin:0 0 1rem;padding:0;border:0}
:where(.semics-page) legend{padding:0;margin-block-end:.5rem;font-weight:600}
:where(.semics-page) button{font:inherit;font-weight:600;min-block-size:2.75rem;padding:.625rem 1.25rem;border:1px solid var(--events-accent, #0b57d0);border-radius:var(--events-radius, 6px);background:var(--events-accent, #0b57d0);color:var(--events-accent-fg, #ffffff);cursor:pointer}
.semics-page-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1.25rem;margin-block:0 1.25rem}
.semics-page-actions .semics-print{background:transparent;color:var(--events-accent, #0b57d0)}
.semics-page-organiser{max-inline-size:40rem;margin-inline:auto;padding:0 1rem 3rem;color:var(--events-muted, #4a4a4a);font-size:.9375rem}
.semics-page-organiser p{margin:0}
.semics-page-organiser address{font-style:normal}
@media print{
@page{margin:15mm}
body.semics-page{min-block-size:0;background:#ffffff;color:#000000;font-size:11pt}
.semics-page-brand,.semics-page-actions,.semics-page-main form,.semics-page-main button,.semics-page-main details,.semics-add-to-calendar,[data-semics-payment-live]{display:none !important}
.semics-page-main{max-inline-size:none;padding:0}
:where(.semics-page-main > section,.semics-page-main > .semics-ceremony){box-shadow:none;border-color:#999999;break-inside:avoid}
.semics-ticket-pass{break-inside:avoid}
.semics-page-organiser{max-inline-size:none;padding:1rem 0 0;color:#000000}
}
`;

/** The stylesheet for a page: the defaults, then the site's theme. Exact: the signing page hashes this text. */
export function pageCss(page: PageOptions = {}): string {
	const set = Object.entries(page.theme ?? {}) as Array<[ThemeProperty, string]>;
	if (set.length === 0) return PAGE_CSS;
	return `${PAGE_CSS}:root{${set.map(([name, value]) => `--events-${name}:${value}`).join(";")}}\n`;
}
