/**
 * Promo codes in the booking widget (EV-FR-14, T078): the widget sends `promoCode` with the order and
 * asks Events Pro's `public/promo/check` (through `/_events/promo`) to reveal hidden ticket types. Free
 * never gets either: the field shows only when `public/event` says the core takes codes (Pro), and an
 * order without a code sends no `promoCode` key (Free's reserve refuses unknown keys).
 */
import { describe, expect, it } from "vitest";

import { handleCheckoutForm } from "../../src/astro/lib/checkout-form";
import { handlePromoRequest, PROMO_PATH, promoCookieName, promoNote, promoView } from "../../src/astro/lib/promo";
import { anchorId, errorMessage, readWidgetState } from "../../src/astro/lib/widget";

const url = new URL("https://site.example/_events/promo");
const KEY = "k".repeat(40);

interface Seen {
	url: string;
	path: string;
	body: unknown;
}

function host(answers: Record<string, unknown>) {
	const seen: Seen[] = [];
	const handler = async (_id: string, method: string, path: string, request: Request) => {
		seen.push({ url: request.url, path, body: method === "POST" ? await request.clone().json() : undefined });
		return answers[path] ?? { success: false, error: { code: "NOT_FOUND", message: "no route" } };
	};
	return { seen, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(entries)) data.set(k, v);
	return data;
}

const order = {
	eventId: "ev1",
	"qty:general": "1",
	name: "Ada",
	email: "ada@example.com",
	idempotencyKey: KEY,
	returnTo: "/events/spring",
};
const reserved = { success: true, data: { ok: true, bookingRef: "ABCDEFGHJK", accessToken: "T".repeat(43) } };
const pay = { success: true, data: { ok: true, next: { type: "pay", url: "https://checkout.stripe.com/c/pay/cs_1" } } };
const unlock = {
	success: true,
	data: { ok: true, valid: true, kind: "unlock", hiddenTypes: [{ id: "vip", name: "VIP", priceMinor: 5000 }] },
};

describe("the order carries the code (EV-FR-14)", () => {
	it("EV-FR-14 sends the typed code to reserve as promoCode, trimmed", async () => {
		const h = host({ "public/checkout/reserve": reserved, "public/checkout/continue": pay });
		const out = await handleCheckoutForm({ locals: h.locals, url }, form({ ...order, promoCode: "  spring25 " }), {});
		expect(h.seen[0]?.body).toMatchObject({ promoCode: "spring25" });
		expect(out.location).toBe("https://checkout.stripe.com/c/pay/cs_1");
	});

	it("EV-FR-14 sends no promoCode key at all without a code, so Free's strict reserve still takes the order", async () => {
		const h = host({ "public/checkout/reserve": reserved, "public/checkout/continue": pay });
		await handleCheckoutForm({ locals: h.locals, url }, form({ ...order, promoCode: "   " }), {});
		expect(Object.keys(h.seen[0]?.body as object)).not.toContain("promoCode");
	});

	it("EV-FR-14 a refused code goes back to the widget on the promo field, the code never in the URL", async () => {
		for (const code of ["PROMO_INVALID", "PROMO_EXHAUSTED", "PROMO_ORDER_TOO_LARGE"]) {
			const refused = { success: true, data: { ok: false, error: { code, message: "no" } } };
			const h = host({ "public/checkout/reserve": refused });
			const out = await handleCheckoutForm({ locals: h.locals, url }, form({ ...order, promoCode: "SECRET-VIP" }), {});
			const loc = new URL(out.location, url);
			expect(loc.pathname).toBe("/events/spring");
			expect(loc.searchParams.get("booking_error")).toBe(code);
			expect(loc.searchParams.get("booking_fields")).toBe("promo");
			expect(out.location).not.toContain("SECRET");
			expect(readWidgetState(loc, "ev1")).toEqual({ code, fields: ["promo"] });
		}
	});

	it("T120 F9 a lapsed licence at reserve with a code says the code cannot be used, on the promo field", async () => {
		for (const code of ["LICENCE_EXPIRED", "LICENCE_INVALID"]) {
			const refused = { success: true, data: { ok: false, error: { code, message: "licence" } } };
			const h = host({ "public/checkout/reserve": refused });
			const out = await handleCheckoutForm({ locals: h.locals, url }, form({ ...order, promoCode: "SPRING25" }), {});
			const loc = new URL(out.location, url);
			expect(loc.searchParams.get("booking_error")).toBe("PROMO_UNAVAILABLE");
			expect(loc.searchParams.get("booking_fields")).toBe("promo");
			const state = readWidgetState(loc, "ev1");
			expect(state).toEqual({ code: "PROMO_UNAVAILABLE", fields: ["promo"] });
			expect(errorMessage(state.code ?? "")).toMatch(/code can't be used/);
		}
	});
});

interface Jar {
	set: Array<[string, string, Record<string, unknown>]>;
	deleted: Array<[string, Record<string, unknown>]>;
}

function endpoint(h: ReturnType<typeof host>, entries: Record<string, string>, headers: Record<string, string> = {}) {
	const jar: Jar = { set: [], deleted: [] };
	const request = new Request(url, {
		method: "POST",
		headers: { "sec-fetch-site": "same-origin", ...headers },
		body: form(entries),
	});
	const ctx = {
		request,
		url,
		locals: h.locals,
		redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
		cookies: {
			set: (name: string, value: string, options: Record<string, unknown>) => jar.set.push([name, value, options]),
			delete: (name: string, options: Record<string, unknown>) => jar.deleted.push([name, options]),
		},
	};
	return { ctx, jar };
}

describe("applying a code (EV-FR-14, T078)", () => {
	const apply = { eventId: "ev1", promoCode: "vip-guest", returnTo: "/events/spring?x=1", name: "Ada" };

	it("EV-FR-14 asks public/promo/check, keeps the code in an HttpOnly cookie and goes back to the widget without it", async () => {
		const h = host({ "public/promo/check": unlock });
		const { ctx, jar } = endpoint(h, apply);
		const res = await handlePromoRequest(ctx, {});
		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe(`/events/spring?x=1#${anchorId("ev1")}`);
		expect(h.seen).toEqual([
			expect.objectContaining({ path: "public/promo/check", body: { eventId: "ev1", code: "vip-guest" } }),
		]);
		expect(h.seen[0]?.url).not.toContain("vip");
		const [name, value, options] = jar.set[0] ?? [];
		expect(name).toBe(promoCookieName("ev1"));
		expect(value).toBe("vip-guest");
		expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: true });
		expect(Number(options?.maxAge)).toBeLessThanOrEqual(3600);
	});

	it("EV-FR-14 a refused code clears the cookie and shows the error on the promo field", async () => {
		const exhausted = { success: true, data: { ok: false, error: { code: "PROMO_EXHAUSTED", message: "used" } } };
		const h = host({ "public/promo/check": exhausted });
		const { ctx, jar } = endpoint(h, apply);
		const res = await handlePromoRequest(ctx, {});
		const loc = new URL(res.headers.get("location") ?? "", url);
		expect(loc.searchParams.get("booking_error")).toBe("PROMO_EXHAUSTED");
		expect(loc.searchParams.get("booking_fields")).toBe("promo");
		expect(res.headers.get("location")).not.toContain("vip");
		expect(jar.set).toEqual([]);
		expect(jar.deleted.map(([n]) => n)).toEqual([promoCookieName("ev1")]);
	});

	it("EV-FR-14 on Free (no such route) or for a garbled code the answer is PROMO_INVALID; a rate limit says so", async () => {
		const free = host({});
		const out = await handlePromoRequest(endpoint(free, apply).ctx, {});
		expect(new URL(out.headers.get("location") ?? "", url).searchParams.get("booking_error")).toBe("PROMO_INVALID");

		const limited = host({
			"public/promo/check": { success: true, data: { ok: false, error: { code: "RATE_LIMITED", message: "slow" } } },
		});
		const slow = await handlePromoRequest(endpoint(limited, apply).ctx, {});
		expect(new URL(slow.headers.get("location") ?? "", url).searchParams.get("booking_error")).toBe("RATE_LIMITED");

		// T120 F9: Pro without a valid licence answers a licence code: the code cannot be used right now.
		const lapsed = host({
			"public/promo/check": { success: true, data: { ok: false, error: { code: "LICENCE_EXPIRED", message: "x" } } },
		});
		const off = await handlePromoRequest(endpoint(lapsed, apply).ctx, {});
		expect(new URL(off.headers.get("location") ?? "", url).searchParams.get("booking_error")).toBe("PROMO_UNAVAILABLE");

		const garbled = host({ "public/promo/check": unlock });
		await handlePromoRequest(endpoint(garbled, { ...apply, promoCode: "x".repeat(200) }).ctx, {});
		expect(garbled.seen).toEqual([]);
	});

	it("EV-FR-14 an empty code removes an applied one without calling the core", async () => {
		const h = host({ "public/promo/check": unlock });
		const { ctx, jar } = endpoint(h, { ...apply, promoCode: " " });
		const res = await handlePromoRequest(ctx, {});
		expect(res.headers.get("location")).toBe(`/events/spring?x=1#${anchorId("ev1")}`);
		expect(h.seen).toEqual([]);
		expect(jar.deleted.map(([n]) => n)).toEqual([promoCookieName("ev1")]);
	});

	it("EV-NFR-05 refuses a cross-site post (CSRF) before reading it, and never redirects off the site", async () => {
		const h = host({ "public/promo/check": unlock });
		const cross = endpoint(h, apply, { "sec-fetch-site": "cross-site" });
		const refused = await handlePromoRequest(cross.ctx, {});
		expect(refused.status).toBe(403);
		expect(h.seen).toEqual([]);
		expect(cross.jar.set).toEqual([]);

		const off = await handlePromoRequest(endpoint(h, { ...apply, returnTo: "//evil.example/x" }).ctx, {});
		expect(off.headers.get("location")).toBe(`/#${anchorId("ev1")}`);
		// Paths that normalise to `//host` (phase 3 review F11) never become a protocol-relative redirect.
		for (const returnTo of ["/.//evil.example/x", "/%2e//evil.example"]) {
			for (const entries of [apply, { ...apply, promoCode: "" }, { ...apply, eventId: "" }]) {
				const res = await handlePromoRequest(endpoint(h, { ...entries, returnTo }).ctx, {});
				const location = res.headers.get("location") ?? "";
				expect(location.startsWith("//"), location).toBe(false);
				expect(new URL(location, url).origin).toBe(url.origin);
			}
		}
	});

	it("is served at /_events/promo", () => {
		expect(PROMO_PATH).toBe("/_events/promo");
	});
});

describe("what the widget shows for an applied code (EV-FR-14)", () => {
	it("EV-FR-14 an unlock code lists the hidden types it reveals", async () => {
		const h = host({ "public/promo/check": unlock });
		const view = await promoView({ locals: h.locals, url }, { eventId: "ev1", code: "vip-guest" }, {});
		expect(view).toEqual({
			code: "vip-guest",
			note: "Code applied: more tickets are now available.",
			hiddenTypes: [{ id: "vip", name: "VIP", priceMinor: 5000 }],
		});
	});

	it("EV-FR-14 no cookie, Free, or a code that stopped working shows nothing extra", async () => {
		const h = host({});
		expect(await promoView({ locals: h.locals, url }, { eventId: "ev1", code: "" }, {})).toBeNull();
		expect(h.seen).toEqual([]);
		expect(await promoView({ locals: h.locals, url }, { eventId: "ev1", code: "vip-guest" }, {})).toBeNull();
	});

	it("EV-FR-14 says what a discount takes off, in the event's currency", () => {
		expect(promoNote({ kind: "percent", value: 1500, hiddenTypes: [] }, "GBP")).toBe(
			"Code applied: 15% off your order.",
		);
		expect(promoNote({ kind: "fixed", value: 500, currency: "GBP", hiddenTypes: [] }, "GBP")).toBe(
			"Code applied: £5.00 off your order.",
		);
		expect(promoNote({ kind: "unlock", hiddenTypes: [] }, "GBP")).toBe("Code applied.");
	});
});
