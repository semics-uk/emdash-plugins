// e2e only (T135): loaded into the playground server with `node --import` (serve.mjs). When
// E2E_STRIPE_URL is set, a Pro core's `ctx.http.fetch` to `https://api.stripe.com/…` reaches the fake
// Stripe the specs run (`fake-stripe.ts`) instead, and EmDash's SSRF check (a DNS-over-HTTPS lookup
// through the same global fetch) gets a public address for api.stripe.com without the network.
// T159: with E2E_FAKE_TURNSTILE=1, Turnstile's `siteverify` is answered here too (no call to Cloudflare):
// success exactly when the token is TURNSTILE_PASS, the one the specs' stand-in Turnstile puts in the form.
// Every other request is untouched; without either variable this file does nothing.
const target = process.env.E2E_STRIPE_URL;
const fakeTurnstile = process.env.E2E_FAKE_TURNSTILE === "1";
export const TURNSTILE_PASS = "e2e-turnstile-pass";

if (target || fakeTurnstile) {
	const real = globalThis.fetch;
	const STRIPE = "https://api.stripe.com/";
	const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
	const DOH = "https://cloudflare-dns.com/dns-query";
	// Public addresses, so the SSRF check passes; nothing is ever sent to them.
	const hosts = {
		...(target ? { "api.stripe.com": "54.187.174.169" } : {}),
		...(fakeTurnstile ? { "challenges.cloudflare.com": "104.16.79.73" } : {}),
	};
	globalThis.fetch = async (input, init) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (target && url.startsWith(STRIPE)) return real(`${target}/${url.slice(STRIPE.length)}`, init);
		if (fakeTurnstile && url.startsWith(SITEVERIFY)) {
			const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : "");
			const text = raw instanceof URLSearchParams ? raw.toString() : typeof raw === "string" ? raw : await new Response(raw).text();
			const form = new URLSearchParams(text);
			const success = form.get("response") === TURNSTILE_PASS && !!form.get("secret");
			return new Response(JSON.stringify({ success, "error-codes": success ? [] : ["invalid-input-response"] }), {
				headers: { "content-type": "application/json" },
			});
		}
		if (url.startsWith(DOH)) {
			const params = new URL(url).searchParams;
			const name = params.get("name") ?? "";
			if (Object.hasOwn(hosts, name)) {
				const type = params.get("type") === "AAAA" ? 28 : 1;
				const answer = type === 1 ? [{ name, type: 1, TTL: 60, data: hosts[name] }] : [];
				return new Response(JSON.stringify({ Status: 0, Answer: answer }), {
					headers: { "content-type": "application/dns-json" },
				});
			}
		}
		return real(input, init);
	};
}
