import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	BUY_MESSAGES,
	BUY_PATH,
	displayCode,
	handleBuyRequest,
	loadBuyOptions,
	loadVoucher,
	readBuyForm,
	readBuyState,
	THANKS_PATH,
} from "../src/astro/lib/buy";

// T168 (T163 §4, §5): <BuyVoucher> posts to /_vouchers/buy, which asks Vouchers' public/purchase in process and
// sends the buyer to Stripe Checkout; the voucher page /_vouchers/v reads Vouchers' public/redeem/check. No
// JavaScript needed. Vouchers is faked here; the playground journey (t168) runs the real Pro bundles.

const VOUCHERS = "r_vouchers1";
const ORIGIN = "https://site.example";
const STRIPE = "https://checkout.stripe.com/c/pay/cs_test_1";

const ok = (data: Record<string, unknown>) => ({ success: true, data: { ok: true, ...data } });
const refused = (code: string) => ({ success: true, data: { ok: false, error: { code, message: code } } });

function host(routes: Record<string, (body: Record<string, unknown>) => unknown>) {
	const calls: Array<{ id: string; path: string; body: Record<string, unknown>; request: Request }> = [];
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		const body = (await request
			.clone()
			.json()
			.catch(() => ({}))) as Record<string, unknown>;
		calls.push({ id, path, body, request });
		const respond = routes[`${id} ${path}`];
		return respond ? respond(body) : refused("NOT_FOUND");
	};
	return { calls, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

function post(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
	return new Request(`${ORIGIN}${BUY_PATH}`, {
		method: "POST",
		body: new URLSearchParams(fields),
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			"sec-fetch-site": "same-origin",
			"cf-connecting-ip": "203.0.113.9",
			...headers,
		},
	});
}

const run = (h: ReturnType<typeof host>, request: Request) =>
	handleBuyRequest({ locals: h.locals, url: new URL(request.url), request }, { vouchersPluginId: VOUCHERS });

const MONEY = {
	returnTo: "/gift-vouchers",
	currency: "GBP",
	kind: "money",
	amount: "5000",
	buyerName: " Ada Lovelace ",
	buyerEmail: "ada@example.com",
	recipientName: "Bob",
	recipientEmail: "",
	message: "Happy birthday",
	delivery: "print",
	"cf-turnstile-response": "ts-token",
};

describe("T168 R16 readBuyForm: the form as public/purchase takes it", () => {
	it("R16 a preset money amount, the buyer, an optional recipient and message, the delivery", () => {
		const out = readBuyForm(new URLSearchParams(MONEY) as never);
		expect(out).toEqual({
			ok: true,
			input: {
				kind: "money",
				amountMinor: 5000,
				buyer: { name: "Ada Lovelace", email: "ada@example.com" },
				recipient: { name: "Bob" },
				message: "Happy birthday",
				delivery: "print",
				turnstileToken: "ts-token",
				returnPath: THANKS_PATH,
			},
		});
	});

	it("R16 another amount is typed in pounds and sent in pence; an activity is its event and ticket type", () => {
		const other = readBuyForm(new URLSearchParams({ ...MONEY, amount: "other", otherAmount: "42.50" }) as never);
		expect(other).toMatchObject({ ok: true, input: { amountMinor: 4250 } });
		const act = readBuyForm(
			new URLSearchParams({ ...MONEY, kind: "activity", amount: "", activity: "ev_clay/tt_session" }) as never,
		);
		expect(act).toMatchObject({
			ok: true,
			input: { kind: "activity", activity: { eventId: "ev_clay", ticketTypeId: "tt_session" } },
		});
		expect(act.ok && "amountMinor" in act.input).toBe(false);
	});

	it("R16 emailing the recipient needs their address; a send date goes with it; posting needs an address", () => {
		const gift = { ...MONEY, delivery: "email-recipient", recipientEmail: "bob@example.com", sendOn: "2026-12-24" };
		expect(readBuyForm(new URLSearchParams(gift) as never)).toMatchObject({
			ok: true,
			input: { recipient: { name: "Bob", email: "bob@example.com" }, sendOn: "2026-12-24" },
		});
		expect(readBuyForm(new URLSearchParams({ ...gift, recipientEmail: "" }) as never)).toEqual({
			ok: false,
			fields: ["recipientEmail"],
		});
		const posted = readBuyForm(new URLSearchParams({ ...MONEY, delivery: "post", address: "1 Lane\nTown" }) as never);
		expect(posted).toMatchObject({ ok: true, input: { delivery: "post", address: "1 Lane\nTown" } });
		expect(readBuyForm(new URLSearchParams({ ...MONEY, delivery: "post" }) as never)).toEqual({
			ok: false,
			fields: ["address"],
		});
	});

	it("R16 names every missing or malformed field so the form can mark it", () => {
		const out = readBuyForm(
			new URLSearchParams({
				...MONEY,
				buyerName: " ",
				buyerEmail: "nope",
				amount: "other",
				otherAmount: "1.234",
			}) as never,
		);
		expect(out).toEqual({ ok: false, fields: ["amount", "buyerName", "buyerEmail"] });
		expect(readBuyForm(new URLSearchParams({ ...MONEY, kind: "activity", activity: "x" }) as never)).toEqual({
			ok: false,
			fields: ["activity"],
		});
		expect(readBuyForm(new URLSearchParams({ ...MONEY, kind: "shop" }) as never)).toEqual({
			ok: false,
			fields: ["kind"],
		});
	});
});

describe("T168 R16 POST /_vouchers/buy", () => {
	it("R16 asks Vouchers for a Checkout Session in process and sends the buyer to Stripe (303)", async () => {
		const h = host({ [`${VOUCHERS} public/purchase`]: () => ok({ orderId: "vo_1", url: STRIPE }) });
		const out = await run(h, post(MONEY));
		expect(out).toEqual({ type: "redirect", location: STRIPE });
		expect(h.calls).toHaveLength(1);
		expect(h.calls[0]?.path).toBe("public/purchase");
		expect(h.calls[0]?.body).toMatchObject({ kind: "money", amountMinor: 5000, returnPath: THANKS_PATH });
		// The visitor's IP reaches Vouchers' per-IP limit.
		expect(h.calls[0]?.request.headers.get("cf-connecting-ip")).toBe("203.0.113.9");
	});

	it("R16 a refusal goes back to the form with its code and fields, never what was typed", async () => {
		const h = host({ [`${VOUCHERS} public/purchase`]: () => refused("TURNSTILE_FAILED") });
		const out = await run(h, post(MONEY));
		expect(out.type).toBe("redirect");
		const location = out.type === "redirect" ? out.location : "";
		expect(location.startsWith("/gift-vouchers?")).toBe(true);
		expect(location).toContain("voucher_error=TURNSTILE_FAILED");
		expect(location).not.toContain("ada");
		const bad = await run(host({}), post({ ...MONEY, buyerEmail: "x" }));
		expect(bad).toMatchObject({ type: "redirect" });
		expect(bad.type === "redirect" && bad.location).toContain("voucher_fields=buyerEmail");
	});

	it("R16 an answer that is not an https Checkout URL is PAYMENT_FAILED", async () => {
		const h = host({ [`${VOUCHERS} public/purchase`]: () => ok({ orderId: "vo_1", url: "http://evil.example/" }) });
		const out = await run(h, post(MONEY));
		expect(out.type === "redirect" && out.location).toContain("voucher_error=PAYMENT_FAILED");
	});

	it("R16 refuses cross-site posts before anything runs, and a return path that leaves the site", async () => {
		const h = host({});
		expect(await run(h, post(MONEY, { "sec-fetch-site": "cross-site" }))).toEqual({ type: "forbidden" });
		expect(h.calls).toEqual([]);
		const away = await run(
			host({ [`${VOUCHERS} public/purchase`]: () => refused("BAD_REQUEST") }),
			post({ ...MONEY, returnTo: "//evil.example/x" }),
		);
		expect(away.type === "redirect" && away.location.startsWith("/?")).toBe(true);
	});

	it("R16 readBuyState reads a refusal back for the form; unknown codes are dropped", () => {
		expect(readBuyState(new URL(`${ORIGIN}/g?voucher_error=RATE_LIMITED&voucher_fields=buyerEmail,amount`))).toEqual({
			code: "RATE_LIMITED",
			fields: ["buyerEmail", "amount"],
		});
		expect(readBuyState(new URL(`${ORIGIN}/g?voucher_error=<b>`))).toBeNull();
		for (const code of ["BAD_REQUEST", "TURNSTILE_FAILED", "RATE_LIMITED", "PAYMENT_FAILED", "INTERNAL"]) {
			expect(BUY_MESSAGES[code], code).toBeTruthy();
		}
	});
});

describe("T168 R16 the buying form and the voucher page read Vouchers", () => {
	it("R16 loadBuyOptions reads public/options; null when Vouchers is not there", async () => {
		const options = { kinds: ["money"], moneyAmounts: [2500], currency: "GBP" };
		const h = host({ [`${VOUCHERS} public/options`]: () => ok(options) });
		expect(await loadBuyOptions({ locals: h.locals, url: new URL(ORIGIN) }, VOUCHERS)).toMatchObject(options);
		expect(await loadBuyOptions({ locals: host({}).locals, url: new URL(ORIGIN) }, VOUCHERS)).toBeNull();
	});

	it("R16 loadVoucher asks public/redeem/check with the code alone and shows it grouped", async () => {
		const voucher = { kind: "money", currency: "GBP", amountMinor: 5000, balanceMinor: 5000 };
		const h = host({ [`${VOUCHERS} public/redeem/check`]: () => ok({ voucher }) });
		const out = await loadVoucher({ locals: h.locals, url: new URL(ORIGIN) }, "abcd efgh jkmn pqrs", VOUCHERS);
		expect(out).toEqual({ ok: true, voucher, display: "ABCD-EFGH-JKMN-PQRS" });
		expect(h.calls[0]?.body).toEqual({ code: "abcd efgh jkmn pqrs" });
		const bad = host({ [`${VOUCHERS} public/redeem/check`]: () => refused("VOUCHER_INVALID") });
		expect(await loadVoucher({ locals: bad.locals, url: new URL(ORIGIN) }, "QQQQ-0000-QQQQ-0000", VOUCHERS)).toEqual({
			ok: false,
			code: "VOUCHER_INVALID",
		});
		expect(await loadVoucher({ locals: bad.locals, url: new URL(ORIGIN) }, "x".repeat(65), VOUCHERS)).toEqual({
			ok: false,
			code: "VOUCHER_INVALID",
		});
	});

	it("R16 displayCode groups a typed code as voucher/1 §7 does (O→0, I and L→1), or null", () => {
		expect(displayCode("abcd-o123-efgh-4567")).toBe("ABCD-0123-EFGH-4567");
		expect(displayCode("ilAB CDEF GHJK MNPQ")).toBe("11AB-CDEF-GHJK-MNPQ");
		expect(displayCode("ABCD-EFGH-JKMN-PQRU")).toBeNull();
		expect(displayCode("short")).toBeNull();
	});
});

describe("T168 R16 the pages", () => {
	const src = (file: string) => readFileSync(resolve(import.meta.dirname, "../src/astro", file), "utf8");

	it("R16 <BuyVoucher> posts to /_vouchers/buy and works without JavaScript", () => {
		const page = src("BuyVoucher.astro");
		expect(page).toContain("action={BUY_PATH}");
		expect(page).toContain('method="post"');
		for (const name of [
			"kind",
			"amount",
			"otherAmount",
			"activity",
			"buyerName",
			"buyerEmail",
			"recipientName",
			"recipientEmail",
			"message",
			"delivery",
		]) {
			expect(page, name).toContain(`name="${name}"`);
		}
	});

	it("R16 the voucher page keeps the code out of referrers and caches, and prints on A4", () => {
		const page = src("VoucherPage.astro");
		expect(page).toContain('"Referrer-Policy", "no-referrer"');
		expect(page).toContain('"Cache-Control", "private, no-store"');
		expect(page).toContain("@page");
		expect(page).toContain("A4");
		expect(page).toContain("Print or save as PDF");
	});
});
