// e2e only (T135): loaded into the playground server with `node --import` (serve.mjs). When
// E2E_STRIPE_URL is set, a Pro core's `ctx.http.fetch` to `https://api.stripe.com/…` reaches the fake
// Stripe the specs run (`fake-stripe.ts`) instead, and EmDash's SSRF check (a DNS-over-HTTPS lookup
// through the same global fetch) gets a public address for api.stripe.com without the network. Every
// other request is untouched; without E2E_STRIPE_URL this file does nothing.
const target = process.env.E2E_STRIPE_URL;

if (target) {
	const real = globalThis.fetch;
	const STRIPE = "https://api.stripe.com/";
	const DOH = "https://cloudflare-dns.com/dns-query";
	globalThis.fetch = async (input, init) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url.startsWith(STRIPE)) return real(`${target}/${url.slice(STRIPE.length)}`, init);
		if (url.startsWith(DOH) && new URL(url).searchParams.get("name") === "api.stripe.com") {
			const type = new URL(url).searchParams.get("type") === "AAAA" ? 28 : 1;
			const answer = type === 1 ? [{ name: "api.stripe.com", type: 1, TTL: 60, data: "54.187.174.169" }] : [];
			return new Response(JSON.stringify({ Status: 0, Answer: answer }), {
				headers: { "content-type": "application/dns-json" },
			});
		}
		return real(input, init);
	};
}
