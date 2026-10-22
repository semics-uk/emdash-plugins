// Checkout load test (T056, Phase 2 exit): N buyers race for the last seats of one ticket type
// through the real no-JS checkout (`POST /_events/checkout`: reserve, then continue), each from
// its own IP (X-Forwarded-For; the server must trust it, see playwright.config.ts), so the per-IP
// limit stays out of the way and only inventory decides. At most `inFlight` requests run at once:
// the machine is small and every checkout is two sandboxed route calls in workerd.
//
//   node load/checkout.mjs [baseURL] [--shared-ip]   (defaults: http://127.0.0.1:4401, 100 buyers, 16 in flight,
//                                       the london-meetup volunteer tickets: 5 seats, 1 per order)
//
// Exits non-zero unless exactly `seats` bookings succeed and every other buyer gets SOLD_OUT.

const DEFAULTS = {
	baseURL: "http://127.0.0.1:4401",
	buyers: 100,
	inFlight: 16,
	slug: "london-meetup",
	ticketTypeId: "tt_london_helper",
};

/** The event id for a slug, from the public listing (rows carry the entry's slug). */
export async function eventIdForSlug(baseURL, slug) {
	const res = await fetch(`${baseURL}/_emdash/api/plugins/semics-events/public/events`);
	const body = await res.json();
	const event = (body?.data?.events ?? []).find((e) => e.slug === slug);
	if (!event) throw new Error(`[load] no listed event with slug ${slug}`);
	return event.eventId;
}

function idempotencyKey(i) {
	return `load-${Date.now().toString(36)}-${i}-${crypto.randomUUID().replaceAll("-", "")}`;
}

/** One buyer: a plain form post, outcome read from the redirect (never followed). */
async function checkout(baseURL, eventId, ticketTypeId, i) {
	const form = new URLSearchParams({
		eventId,
		[`qty:${ticketTypeId}`]: "1",
		name: `Load Buyer ${i}`,
		email: `load-${i}@example.com`,
		idempotencyKey: idempotencyKey(i),
	});
	const res = await fetch(`${baseURL}/_events/checkout`, {
		method: "POST",
		redirect: "manual",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			origin: baseURL,
			// One address per buyer keeps each in its own rate-limit bucket.
			"x-forwarded-for": `10.56.${Math.floor(i / 250)}.${(i % 250) + 1}`,
		},
		body: form,
	});
	const location = new URL(res.headers.get("location") ?? "/", baseURL);
	const ref = location.searchParams.get("ref");
	const error = location.searchParams.get("error");
	if (res.status === 303 && ref && !error) return { ok: true, ref };
	return { ok: false, code: error ?? `HTTP_${res.status}` };
}

/**
 * Runs the race and returns `{ booked: refs[], refused: { CODE: count }, maxInFlight }`.
 * Buyers start in order, at most `inFlight` at a time.
 */
export async function runCheckoutLoad(options = {}) {
	const o = { ...DEFAULTS, ...options };
	const eventId = o.eventId ?? (await eventIdForSlug(o.baseURL, o.slug));
	const booked = [];
	const refused = {};
	let next = 0;
	let active = 0;
	let maxInFlight = 0;
	async function worker() {
		while (next < o.buyers) {
			const i = next++;
			active++;
			maxInFlight = Math.max(maxInFlight, active);
			try {
				const out = await checkout(o.baseURL, eventId, o.ticketTypeId, i);
				if (out.ok) booked.push(out.ref);
				else refused[out.code] = (refused[out.code] ?? 0) + 1;
			} finally {
				active--;
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(o.inFlight, o.buyers) }, worker));
	return { eventId, booked, refused, maxInFlight };
}

/**
 * The Phase 2 exit verdict: exactly `seats` bookings and every other buyer refused SOLD_OUT. With
 * `sharedIp` (staging: Cloudflare gives the core the runner's real address, so every buyer shares one
 * per-IP bucket, R82) RATE_LIMITED also counts as a clean refusal; any other outcome still fails.
 */
export function loadVerdict(result, { seats, buyers, sharedIp = false }) {
	const allowed = sharedIp ? ["SOLD_OUT", "RATE_LIMITED"] : ["SOLD_OUT"];
	const clean = Object.entries(result.refused)
		.filter(([code]) => allowed.includes(code))
		.reduce((n, [, count]) => n + count, 0);
	const ok = result.booked.length === seats && clean === buyers - seats;
	return { ok, booked: result.booked.length, refused: result.refused };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const baseURL = args.find((a) => !a.startsWith("--")) ?? DEFAULTS.baseURL;
	const result = await runCheckoutLoad({ baseURL });
	const verdict = loadVerdict(result, { seats: 5, buyers: DEFAULTS.buyers, sharedIp: args.includes("--shared-ip") });
	console.log(JSON.stringify({ ...verdict, maxInFlight: result.maxInFlight }));
	process.exit(verdict.ok ? 0 : 1);
}
