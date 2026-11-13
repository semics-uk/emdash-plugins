import { describe, expect, it } from "vitest";

import { reconcileBooking } from "../src/astro/lib/reconcile";
import { routeStripeWebhook } from "../src/astro/lib/stripe";
import { checkVoucher, holdVoucher, settleVoucher } from "../src/astro/lib/voucher";

// T166 (T163 §4a, §6; voucher/1 §8): the suite carries gift voucher tokens between Events and Vouchers in
// process. Both cores are faked here; the Pro repo proves the real bundles (workerd) end to end.

const EVENTS = "r_events1";
const VOUCHERS = "r_vouchers1";
const IDS = { eventsPluginId: EVENTS, vouchersPluginId: VOUCHERS };
const REF = "ABCDEFGHJK";
const ACCESS = "A".repeat(43);
const tok = (c: string) => `${c.repeat(40)}.${"s".repeat(43)}`;
const ORIGIN = "https://site.example";

type Responder = (body: Record<string, unknown>, n: number, request: Request) => unknown;
const ok = (data: Record<string, unknown>) => ({ success: true, data: { ok: true, ...data } });
const refused = (code: string, extra: Record<string, unknown> = {}) => ({
	success: true,
	data: { ok: false, error: { code, message: code }, ...extra },
});

function host(routes: Record<string, Responder>) {
	const calls: Array<{ id: string; path: string; body: Record<string, unknown>; request: Request }> = [];
	const counts = new Map<string, number>();
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		const body = (await request
			.clone()
			.json()
			.catch(() => ({}))) as Record<string, unknown>;
		calls.push({ id, path, body, request });
		const key = `${id} ${path}`;
		const n = (counts.get(key) ?? 0) + 1;
		counts.set(key, n);
		const respond = routes[key];
		return respond ? respond(body, n, request) : refused("NOT_FOUND");
	};
	return { calls, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

const visitor = new Request(`${ORIGIN}/events/climb`, { headers: { "cf-connecting-ip": "203.0.113.9" } });
const ctx = (h: ReturnType<typeof host>) => ({ locals: h.locals, url: new URL(ORIGIN), request: visitor });

/** Events' booking answer: the stored lines (with their unit prices) and the totals after any promo. */
const booking = () =>
	ok({
		bookingRef: REF,
		eventId: "ev_1",
		lines: [
			{ ticketTypeId: "tt_adult", qty: 2, unitPriceMinor: 2000 },
			{ ticketTypeId: "tt_child", qty: 1, unitPriceMinor: 1000 },
		],
		totals: { subtotalMinor: 5000, discountMinor: 500, totalMinor: 4500, currency: "GBP" },
	});

describe("T166 R16 holdVoucher: reserve, then hold (voucher/1 §8.1)", () => {
	it("R16 asks Vouchers for a hold with Events' own ref, amount due, currency and lines, never the browser's", async () => {
		const h = host({
			[`${EVENTS} public/booking`]: booking,
			[`${VOUCHERS} public/redeem/hold`]: () => ok({ hold: tok("h") }),
		});
		const out = await holdVoucher(ctx(h), { code: "ABCD-EFGH-JKMN-PQRS", bookingRef: REF, accessToken: ACCESS }, IDS);
		expect(out).toEqual({ ok: true, hold: tok("h") });
		expect(h.calls[0]?.body).toEqual({ bookingRef: REF, accessToken: ACCESS });
		expect(h.calls[1]?.body).toEqual({
			code: "ABCD-EFGH-JKMN-PQRS",
			ref: REF,
			dueMinor: 4500,
			currency: "GBP",
			lines: [
				{ eventId: "ev_1", ticketTypeId: "tt_adult", unitMinor: 2000, qty: 2 },
				{ eventId: "ev_1", ticketTypeId: "tt_child", unitMinor: 1000, qty: 1 },
			],
		});
	});

	it("R16 passes the visitor's IP on to Vouchers, so its per-IP limit sees visitors, not one shared bucket", async () => {
		const h = host({
			[`${EVENTS} public/booking`]: booking,
			[`${VOUCHERS} public/redeem/hold`]: () => ok({ hold: tok("h") }),
		});
		await holdVoucher(ctx(h), { code: "ABCD-EFGH-JKMN-PQRS", bookingRef: REF, accessToken: ACCESS }, IDS);
		expect(h.calls[1]?.request.headers.get("cf-connecting-ip")).toBe("203.0.113.9");
	});

	it("R16 VOUCHER_NO_BALANCE with open holds: looks each up with Events, settles what it answers, retries once", async () => {
		const h = host({
			[`${EVENTS} public/booking`]: booking,
			[`${VOUCHERS} public/redeem/hold`]: (_b, n) =>
				n === 1 ? refused("VOUCHER_NO_BALANCE", { lookups: [tok("l"), tok("m")] }) : ok({ hold: tok("h") }),
			[`${EVENTS} public/voucher/lookup`]: (b) =>
				b.request === tok("l") ? ok({ state: "settled", settle: tok("x") }) : ok({ state: "pending", settle: null }),
			[`${VOUCHERS} public/redeem/settle`]: () => ok({ state: "released" }),
		});
		const out = await holdVoucher(ctx(h), { code: "ABCD-EFGH-JKMN-PQRS", bookingRef: REF, accessToken: ACCESS }, IDS);
		expect(out).toEqual({ ok: true, hold: tok("h") });
		expect(h.calls.map((c) => `${c.id} ${c.path}`)).toEqual([
			`${EVENTS} public/booking`,
			`${VOUCHERS} public/redeem/hold`,
			`${EVENTS} public/voucher/lookup`,
			`${EVENTS} public/voucher/lookup`,
			`${VOUCHERS} public/redeem/settle`,
			`${VOUCHERS} public/redeem/hold`,
		]);
		expect(h.calls[4]?.body).toEqual({ settle: tok("x") });
	});

	it("R16 a second VOUCHER_NO_BALANCE is the answer: no loop", async () => {
		const h = host({
			[`${EVENTS} public/booking`]: booking,
			[`${VOUCHERS} public/redeem/hold`]: () => refused("VOUCHER_NO_BALANCE", { lookups: [tok("l")] }),
			[`${EVENTS} public/voucher/lookup`]: () => ok({ state: "pending", settle: null }),
		});
		const out = await holdVoucher(ctx(h), { code: "ABCD-EFGH-JKMN-PQRS", bookingRef: REF, accessToken: ACCESS }, IDS);
		expect(out).toEqual({ ok: false, code: "VOUCHER_NO_BALANCE" });
		expect(h.calls.filter((c) => c.path === "public/redeem/hold")).toHaveLength(2);
	});

	it("R16 passes Vouchers' refusal codes on; anything unexpected is VOUCHER_UNAVAILABLE", async () => {
		for (const [code, want] of [
			["VOUCHER_INVALID", "VOUCHER_INVALID"],
			["VOUCHER_WRONG_ACTIVITY", "VOUCHER_WRONG_ACTIVITY"],
			["RATE_LIMITED", "RATE_LIMITED"],
			["NOT_FOUND", "VOUCHER_UNAVAILABLE"],
		]) {
			const h = host({
				[`${EVENTS} public/booking`]: booking,
				[`${VOUCHERS} public/redeem/hold`]: () => refused(code as string),
			});
			const out = await holdVoucher(ctx(h), { code: "X", bookingRef: REF, accessToken: ACCESS }, IDS);
			expect(out, code).toEqual({ ok: false, code: want });
		}
		const lost = host({});
		expect(await holdVoucher(ctx(lost), { code: "X", bookingRef: REF, accessToken: ACCESS }, IDS)).toEqual({
			ok: false,
			code: "VOUCHER_UNAVAILABLE",
		});
	});

	it("R16 refuses an over-long code before asking anyone", async () => {
		const h = host({});
		const out = await holdVoucher(ctx(h), { code: "A".repeat(65), bookingRef: REF, accessToken: ACCESS }, IDS);
		expect(out).toEqual({ ok: false, code: "VOUCHER_INVALID" });
		expect(h.calls).toEqual([]);
	});
});

// T168 (from T166): the code is checked before Events reserves, so a refused code leaves no booking behind.
describe("T168 R16 checkVoucher: before reserving (Vouchers public/redeem/check)", () => {
	const input = { code: "ABCD-EFGH-JKMN-PQRS", eventId: "ev_1", ticketTypeIds: ["tt_adult", "tt_child"] };

	it("R16 asks Vouchers with the code and the order's ticket types; a live voucher passes", async () => {
		const h = host({ [`${VOUCHERS} public/redeem/check`]: () => ok({ voucher: { kind: "money" } }) });
		expect(await checkVoucher(ctx(h), input, IDS)).toEqual({ ok: true });
		expect(h.calls).toHaveLength(1);
		expect(h.calls[0]?.body).toEqual({
			code: "ABCD-EFGH-JKMN-PQRS",
			lines: [
				{ eventId: "ev_1", ticketTypeId: "tt_adult" },
				{ eventId: "ev_1", ticketTypeId: "tt_child" },
			],
		});
		expect(h.calls[0]?.request.headers.get("cf-connecting-ip")).toBe("203.0.113.9");
	});

	it("R16 passes each VOUCHER_* refusal and RATE_LIMITED on", async () => {
		for (const code of [
			"VOUCHER_INVALID",
			"VOUCHER_NO_BALANCE",
			"VOUCHER_WRONG_ACTIVITY",
			"VOUCHER_UNAVAILABLE",
			"RATE_LIMITED",
		]) {
			const h = host({ [`${VOUCHERS} public/redeem/check`]: () => refused(code) });
			expect(await checkVoucher(ctx(h), input, IDS), code).toEqual({ ok: false, code });
		}
	});

	it("R16 a Vouchers without the route, or one that fails, does not block: the hold decides as before", async () => {
		expect(await checkVoucher(ctx(host({})), input, IDS)).toEqual({ ok: true });
		const broken = host({
			[`${VOUCHERS} public/redeem/check`]: () => {
				throw new Error("down");
			},
		});
		expect(await checkVoucher(ctx(broken), input, IDS)).toEqual({ ok: true });
	});

	it("R16 refuses an over-long code before asking anyone", async () => {
		const h = host({});
		expect(await checkVoucher(ctx(h), { ...input, code: "A".repeat(65) }, IDS)).toEqual({
			ok: false,
			code: "VOUCHER_INVALID",
		});
		expect(h.calls).toEqual([]);
	});
});

describe("T166 R16 settling a hold on the booking page (voucher/1 §5.2, §8.2)", () => {
	it("R16 settleVoucher passes Events' settle token to Vouchers", async () => {
		const h = host({ [`${VOUCHERS} public/redeem/settle`]: () => ok({ state: "confirmed" }) });
		expect(await settleVoucher(ctx(h), tok("x"), VOUCHERS)).toBe(true);
		expect(h.calls[0]?.body).toEqual({ settle: tok("x") });
		expect(await settleVoucher(ctx(h), "not a token", VOUCHERS)).toBe(false);
		expect(h.calls).toHaveLength(1);
	});

	it("R16 reconcileBooking settles a voucher the booking answers a token for, even with no waiver", async () => {
		const h = host({ [`${VOUCHERS} public/redeem/settle`]: () => ok({ state: "confirmed" }) });
		const out = await reconcileBooking(ctx(h), {
			booking: { bookingRef: REF, voucher: { settle: tok("x") } } as never,
			pluginId: EVENTS,
			esignPluginId: "r_esign1",
			vouchersPluginId: VOUCHERS,
		});
		expect(out).toEqual({ forwarded: 0, settled: 1 });
		expect(h.calls.map((c) => c.path)).toEqual(["public/redeem/settle"]);
	});
});

describe("T166 R16 POST /_semics/stripe: one Stripe endpoint for the site (T163 §4a)", () => {
	const event = (metadata: Record<string, unknown> | undefined) =>
		JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", metadata } } });
	const delivery = (body: string) =>
		new Request(`${ORIGIN}/_semics/stripe`, {
			method: "POST",
			body,
			headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=abc" },
		});
	const raw = (status: number, value: string) => ({
		success: true,
		data: { status, headers: { "content-type": "application/json" }, body: { kind: "text", value } },
	});
	const route = async (body: string, ids: { eventsPluginId: string; vouchersPluginId?: string } = IDS) => {
		const seen: Array<{ id: string; path: string; body: string; signature: string | null }> = [];
		const handler = async (id: string, _m: string, path: string, request: Request) => {
			seen.push({ id, path, body: await request.text(), signature: request.headers.get("stripe-signature") });
			return id === VOUCHERS ? raw(400, '{"error":"SIGNATURE_INVALID"}') : raw(200, '{"received":true}');
		};
		const request = delivery(body);
		const response = await routeStripeWebhook(
			{ locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url: new URL(request.url), request },
			ids,
		);
		return { seen, response };
	};

	it("R16 a session tagged plugin=vouchers goes to Vouchers' webhooks/stripe with the raw body and signature", async () => {
		const body = event({ plugin: "vouchers", order: "o1" });
		const { seen, response } = await route(body);
		expect(seen).toEqual([{ id: VOUCHERS, path: "webhooks/stripe", body, signature: "t=1,v1=abc" }]);
		// A forged tag reaches only a plugin that verifies the signature itself, and rejects it.
		expect(response.status).toBe(400);
	});

	it("R16 untagged (old sessions), events-tagged and unknown tags go to Events", async () => {
		for (const metadata of [undefined, { plugin: "events" }, { plugin: "shop" }]) {
			const body = event(metadata);
			const { seen, response } = await route(body);
			expect(seen.map((s) => s.id)).toEqual([EVENTS]);
			expect(seen[0]?.body).toBe(body);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('{"received":true}');
		}
	});

	it("R16 a vouchers tag on a site without Vouchers, or a body that is not JSON, goes to Events", async () => {
		expect((await route(event({ plugin: "vouchers" }), { eventsPluginId: EVENTS })).seen.map((s) => s.id)).toEqual([
			EVENTS,
		]);
		expect((await route("not json")).seen.map((s) => s.id)).toEqual([EVENTS]);
	});
});
