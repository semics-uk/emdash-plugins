// i18n-ignore-file: Content-Security-Policy directives, no text for people (T102).
import { CEREMONY_CSS, CEREMONY_SCRIPT, PAD_SCRIPT, VERIFY_CSS, VERIFY_SCRIPT } from "./assets.ts";

/**
 * The signing page's Content-Security-Policy (SU-NFR-02): nothing loads or runs but the package's
 * own inlined scripts (ceremony, signature pad) and stylesheet, each allowed by its SHA-256. Forms post only to the site,
 * scripts fetch only from it (the `public/session` poll), and the page cannot be framed.
 */

/** The CSP source expression for inline text: `'sha256-<base64 of SHA-256(UTF-8 text)>'`. */
export async function cspSource(text: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	let binary = "";
	for (const byte of digest) binary += String.fromCharCode(byte);
	return `'sha256-${btoa(binary)}'`;
}

let cached: Promise<string> | undefined;

/** What a host page adds to the ceremony's own: its exact inline stylesheets, and one linked stylesheet (absolute URL). */
export interface CeremonyCspExtras {
	styles?: readonly string[];
	stylesheet?: string | undefined;
}

/**
 * The header value for any page that renders <SigningCeremony> and nothing else inline but `extras`. A linked
 * stylesheet is allowed by its exact URL, with `font-src 'self'` for the fonts it may name; scripts never change.
 */
export function ceremonyCsp(extras?: CeremonyCspExtras): Promise<string> {
	if (extras) return ceremonyCspFor(extras);
	cached ??= ceremonyCspFor({});
	return cached;
}

async function ceremonyCspFor({ styles = [], stylesheet }: CeremonyCspExtras): Promise<string> {
	const [script, pad, ...sources] = await Promise.all(
		[CEREMONY_SCRIPT, PAD_SCRIPT, CEREMONY_CSS, ...styles].map(cspSource),
	);
	return [
		"default-src 'none'",
		`script-src ${script} ${pad}`,
		`style-src ${[...sources, ...(stylesheet ? [stylesheet] : [])].join(" ")}`,
		"img-src 'self' data:",
		...(stylesheet ? ["font-src 'self'"] : []),
		"connect-src 'self'",
		"form-action 'self'",
		"base-uri 'none'",
		"frame-ancestors 'none'",
	].join("; ");
}

let cachedVerify: Promise<string> | undefined;

/**
 * The header value for the `/verify` page: only its own hashed script and style. The script has no
 * network code, so there is no `connect-src` (it falls back to `default-src 'none'`); the form posts
 * to the site, and the page cannot be framed.
 */
export function verifyCsp(): Promise<string> {
	cachedVerify ??= Promise.all([cspSource(VERIFY_SCRIPT), cspSource(VERIFY_CSS)]).then(([script, style]) =>
		[
			"default-src 'none'",
			`script-src ${script}`,
			`style-src ${style}`,
			"form-action 'self'",
			"base-uri 'none'",
			"frame-ancestors 'none'",
		].join("; "),
	);
	return cachedVerify;
}
