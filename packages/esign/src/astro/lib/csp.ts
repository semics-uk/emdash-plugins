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

/** The header value for any page that renders <SigningCeremony> and nothing else inline. */
export function ceremonyCsp(): Promise<string> {
	cached ??= Promise.all([cspSource(CEREMONY_SCRIPT), cspSource(PAD_SCRIPT), cspSource(CEREMONY_CSS)]).then(
		([script, pad, style]) =>
			[
				"default-src 'none'",
				`script-src ${script} ${pad}`,
				`style-src ${style}`,
				"img-src 'self' data:",
				"connect-src 'self'",
				"form-action 'self'",
				"base-uri 'none'",
				"frame-ancestors 'none'",
			].join("; "),
	);
	return cached;
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
