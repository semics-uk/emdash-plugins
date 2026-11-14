// i18n-ignore-file: a stylesheet and its option names, no text for people.
/**
 * The look of e-sign's own pages (`/sign/[token]`, `/signed/[token]`, `/verify`), which run outside the site's
 * layout (T169): what a site sets through `esignIntegration({ page })` (the events suite feeds it from
 * `eventsSuite({ page })`). The inline stylesheet is one exact string, allowed by its hash in the page's CSP.
 * Web APIs only (R35).
 */

/** A theme value by property: `accent` sets `--esign-accent`, which the ceremony and verify styles read. */
export const ESIGN_THEME_PROPERTIES = [
	"fg",
	"muted",
	"bg",
	"border",
	"accent",
	"accent-fg",
	"error",
	"radius",
	"font",
	"page-bg",
] as const;
export type EsignThemeProperty = (typeof ESIGN_THEME_PROPERTIES)[number];

export interface EsignPageBrand {
	/** The site's name: the link's text, or the logo's alternative text; also at the page's foot. */
	name: string;
	/** Where it links, a path on this site (default `/`). */
	href?: string;
	/** A logo, a path on this site. */
	logo?: string;
	/** A postal address, one line, at the page's foot. */
	address?: string;
}

export interface EsignPageOptions {
	/** Values for the pages' custom properties, for example `{ accent: "#1f3a2e", "page-bg": "#f6f1ea" }`. */
	theme?: Partial<Record<EsignThemeProperty, string>>;
	/** The whole inline stylesheet, in place of e-sign's own and `theme` (the events suite passes its page sheet). */
	css?: string;
	/** A stylesheet on this site, loaded after the inline one: for `@font-face`, or any further rules. */
	stylesheet?: string;
	/** The site's name or logo at the top of each page, and at its foot. */
	brand?: EsignPageBrand;
}

/** One line of CSS, nothing that could end the declaration, the rule or the `<style>` element. */
const THEME_VALUE = /^[^;{}<>\\@]{1,200}$/;
/** A path on this site; `;` and `,` would end a source in the page's CSP header. */
const SITE_PATH = /^\/(?!\/)[^\s"'<>\\;,]*$/;

/** One line of text for people: 1 to 300 characters, no control characters. */
function oneLine(value: unknown): boolean {
	if (typeof value !== "string" || !value.trim() || value.length > 300) return false;
	for (let i = 0; i < value.length; i++) {
		const unit = value.charCodeAt(i);
		if (unit <= 0x1f || unit === 0x7f) return false;
	}
	return true;
}

/** Checks a site's page options when its config loads; a bad value stops the build with its name. */
export function checkEsignPage(page: EsignPageOptions = {}): EsignPageOptions {
	const refuse = (what: string) => {
		throw new Error(`esignIntegration: page.${what} is not valid`); // i18n-ignore
	};
	for (const [name, value] of Object.entries(page.theme ?? {})) {
		const known = (ESIGN_THEME_PROPERTIES as readonly string[]).includes(name);
		if (!known || typeof value !== "string" || !THEME_VALUE.test(value) || /url\(/i.test(value))
			refuse(`theme.${name}`);
	}
	const { css, stylesheet, brand } = page;
	// Inline in a <style> element: nothing that could close it.
	if (css !== undefined && (typeof css !== "string" || css.includes("</"))) refuse("css");
	if (stylesheet !== undefined && !SITE_PATH.test(stylesheet)) refuse("stylesheet");
	if (brand) {
		if (typeof brand.name !== "string" || !brand.name.trim()) refuse("brand.name");
		if (brand.href !== undefined && !SITE_PATH.test(brand.href)) refuse("brand.href");
		if (brand.logo !== undefined && !SITE_PATH.test(brand.logo)) refuse("brand.logo");
		if (brand.address !== undefined && !oneLine(brand.address)) refuse("brand.address");
	}
	return page;
}

/**
 * E-sign's own page sheet: a readable page with no site theme at all, on the same class names as the events
 * pages (`semics-page`, `-brand`, `-main`, `-organiser`), so the suite's sheet styles these pages too.
 */
export const ESIGN_PAGE_CSS = `*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body.semics-page{margin:0;min-block-size:100vh;background:var(--esign-page-bg, #f5f4f0);color:var(--esign-fg, #1a1a1a);font-family:var(--esign-font, system-ui, sans-serif);line-height:1.55;overflow-wrap:anywhere}
.semics-page-brand,.semics-page-main,.semics-page-organiser{max-inline-size:46rem;margin-inline:auto;padding:1.25rem 1rem 0}
.semics-page-brand{font-weight:600}
.semics-page-brand a{color:inherit;text-decoration:none}
.semics-page-brand img{display:block;block-size:2.5rem;inline-size:auto;max-inline-size:100%}
.semics-page-main{padding-block:1.5rem 2rem}
:where(.semics-page) h1{margin:0 0 1.25rem;line-height:1.2;font-size:clamp(1.75rem,1.5rem + 1.5vw,2.25rem)}
:where(.semics-page) a{color:var(--esign-accent, #0b57d0);text-underline-offset:.2em}
:where(.semics-page) :focus-visible{outline:3px solid var(--esign-accent, #0b57d0);outline-offset:2px}
.semics-page-organiser{padding-block:0 3rem;color:var(--esign-muted, #4a4a4a);font-size:.9375rem}
.semics-page-organiser p{margin:0}
.semics-page-organiser address{font-style:normal}
`;

/** The inline stylesheet for the pages: the site's `css`, else e-sign's own sheet and the site's theme. */
export function esignPageCss(page: EsignPageOptions = {}): string {
	if (page.css !== undefined) return page.css;
	const set = Object.entries(page.theme ?? {}) as Array<[EsignThemeProperty, string]>;
	if (set.length === 0) return ESIGN_PAGE_CSS;
	return `${ESIGN_PAGE_CSS}:root{${set.map(([name, value]) => `--esign-${name}:${value}`).join(";")}}\n`;
}

/**
 * How the pages' document starts (T169): a comment, then the doctype, written as one chunk (`<Fragment set:html>`).
 * EmDash 1.2 injects its visual-edit toolbar for a signed-in editor only into a response that starts with
 * `<!doctype` or `<html` (`injectBeforeBodyEnd`), and these pages' CSP would leave it unstyled; a comment before
 * the doctype keeps the page in standards mode. Astro drops a literal doctype from a template and adds its own in
 * front of the first chunk unless that chunk names one, hence one string.
 */
export const DOCUMENT_START = "<!-- semics: signing page, no editor toolbar --><!doctype html>";

/** What a page renders and its CSP allows: the inline sheet, the linked one as an absolute URL, and the brand. */
export function pageView(
	page: EsignPageOptions,
	url: URL,
): { css: string; stylesheet: string | undefined; brand: EsignPageBrand | undefined } {
	return {
		css: esignPageCss(page),
		stylesheet: page.stylesheet ? new URL(page.stylesheet, url).href : undefined,
		brand: page.brand,
	};
}
