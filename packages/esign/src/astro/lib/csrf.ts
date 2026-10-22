/**
 * The UI pages' own CSRF check (T034). EmDash 1.2 turns Astro's `security.checkOrigin` off and its
 * own check covers only `/_emdash/api`, so `/sign/[token]` (sign and decline) and `/verify` refuse a
 * form post another site made. The browser says so in `Sec-Fetch-Site`; older browsers send an
 * `Origin`, compared with the page's origin or, because Astro builds `url` from `localhost` unless
 * the host is in `security.allowedDomains`, with the `Host` the browser sent (another site cannot set
 * it). Safe methods and clients that send neither header (not browsers) pass. Written locally: the
 * UI never imports `@semics-tech/shared` (R35) or Events.
 */
export function isCrossSiteRequest(request: Request, url: URL): boolean {
	if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return false;
	const site = request.headers.get("sec-fetch-site");
	if (site) return site !== "same-origin" && site !== "none";
	const origin = request.headers.get("origin");
	if (origin === null || origin === url.origin) return false;
	try {
		return new URL(origin).host !== request.headers.get("host");
	} catch {
		return true;
	}
}

/** The answer to a refused cross-site post. */
export const crossSiteResponse = () =>
	new Response("Cross-site form submissions are not allowed.", {
		status: 403,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
		},
	});
