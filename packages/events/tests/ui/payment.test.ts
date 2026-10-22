import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { handleCheckoutForm, resumePayment } from "../../src/astro/lib/checkout-form";
import { isPayUrl, paymentView } from "../../src/astro/lib/payment";
import type { BookingView } from "../../src/astro/lib/widget";
import { POLL_DELAYS_MS, pollPayment } from "../../src/client/payment";

const TOKEN = "T".repeat(43);
const REF = "ABCDEFGHJK";
const url = new URL("https://site.example/events/spring");
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const booking = (over: Partial<BookingView> = {}): BookingView => ({
	bookingRef: REF,
	status: "awaiting_payment",
	lines: [{ ticketTypeId: "tt1", qty: 2 }],
	totals: { totalMinor: 5000, currency: "GBP" },
	holdExpiresAt: "2030-01-01T10:00:00.000Z",
	attendees: [],
	canCancel: true,
	...over,
});

describe("paymentView (EU-FR-09)", () => {
	it("EU-FR-09 shows every outcome of a paid booking", () => {
		const states = (status: string) => paymentView(booking({ status }))?.state;
		expect(states("confirmed")).toBe("confirmed");
		expect(states("awaiting_payment")).toBe("pending");
		expect(states("expired")).toBe("expired");
		expect(states("cancelled")).toBe("cancelled");
		expect(states("refunded")).toBe("refunded");
		expect(states("refunded_unavailable")).toBe("refunded_unavailable");
	});

	it("EU-FR-09 only the pending state polls and offers payment again", () => {
		expect(paymentView(booking())).toMatchObject({ poll: true, resume: true });
		for (const status of ["confirmed", "expired", "cancelled", "refunded", "refunded_unavailable"]) {
			expect(paymentView(booking({ status }))).toMatchObject({ poll: false, resume: false });
		}
	});

	it("EU-FR-09 a free booking has no payment section, unless it was refunded", () => {
		const free = { totals: { totalMinor: 0, currency: "GBP" } };
		expect(paymentView(booking({ ...free, status: "confirmed" }))).toBeNull();
		expect(paymentView(booking({ ...free, status: "cancelled" }))).toBeNull();
		expect(paymentView(booking({ status: "held" }))).toBeNull();
		expect(paymentView(booking({ status: "awaiting_signature" }))).toBeNull();
	});

	it("EU-FR-09 says plainly what happened to the money (R2)", () => {
		expect(paymentView(booking({ status: "refunded_unavailable" }))?.body).toMatch(/refunded in full/i);
		expect(paymentView(booking({ status: "expired" }))?.body).toMatch(/refund/i);
		expect(paymentView(booking())?.body).toMatch(/held until/i);
	});
});

describe("isPayUrl (EU-FR-09)", () => {
	it("EU-FR-09 follows https provider urls only", () => {
		expect(isPayUrl("https://checkout.stripe.com/c/pay/cs_1")).toBe(true);
		for (const bad of ["http://x.example/", "javascript:alert(1)", "//x.example", "/booking", "", 5, null]) {
			expect(isPayUrl(bad)).toBe(false);
		}
	});
});

function host(cont: unknown) {
	const seen: Array<{ path: string; body: unknown }> = [];
	const handler = async (_id: string, _m: string, path: string, request: Request) => {
		seen.push({ path, body: await request.clone().json() });
		return path === "public/checkout/reserve"
			? { success: true, data: { ok: true, bookingRef: REF, accessToken: TOKEN } }
			: cont;
	};
	return { seen, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}
const form = (entries: Record<string, string>) => {
	const data = new FormData();
	for (const [k, v] of Object.entries(entries)) data.set(k, v);
	return data;
};

describe("the redirect to payment (EU-FR-09)", () => {
	it("EU-FR-09 a pay step with a non-https url is not followed", async () => {
		const h = host({ success: true, data: { ok: true, next: { type: "pay", url: "javascript:alert(1)" } } });
		const out = await handleCheckoutForm(
			{ locals: h.locals, url },
			form({ eventId: "ev1", "qty:t": "1", name: "Ada", email: "ada@example.com", idempotencyKey: "k".repeat(40) }),
			{},
		);
		expect(out.location).toBe(`/booking?ref=${REF}&error=PAYMENT_FAILED`);
		expect(out.cookie?.value).toBe(TOKEN);
	});

	it("EU-FR-09 resuming payment continues the booking with the cookie token and follows the pay url", async () => {
		const h = host({ success: true, data: { ok: true, next: { type: "pay", url: "https://pay.example/s/1" } } });
		const out = await resumePayment({ locals: h.locals, url }, { ref: REF, token: TOKEN }, {});
		expect(out).toEqual({ location: "https://pay.example/s/1" });
		expect(h.seen).toEqual([{ path: "public/checkout/continue", body: { bookingRef: REF, accessToken: TOKEN } }]);
	});

	it("EU-FR-09 resuming with a lapsed hold, no token or a bad ref lands on the booking page", async () => {
		const lapsed = host({ success: true, data: { ok: false, error: { code: "HOLD_EXPIRED", message: "x" } } });
		expect((await resumePayment({ locals: lapsed.locals, url }, { ref: REF, token: TOKEN }, {})).location).toBe(
			`/booking?ref=${REF}&error=HOLD_EXPIRED`,
		);
		const none = host({});
		expect((await resumePayment({ locals: none.locals, url }, { ref: REF, token: "" }, {})).location).toBe(
			`/booking?ref=${REF}`,
		);
		expect((await resumePayment({ locals: none.locals, url }, { ref: "nope", token: TOKEN }, {})).location).toBe(
			"/booking",
		);
		expect(none.seen).toEqual([]);
		const done = host({ success: true, data: { ok: true, next: { type: "done" } } });
		expect((await resumePayment({ locals: done.locals, url }, { ref: REF, token: TOKEN }, {})).location).toBe(
			`/booking?ref=${REF}`,
		);
	});
});

describe("pollPayment (EU-FR-09)", () => {
	const noWait = async () => {};

	it("EU-FR-09 polls politely: growing delays, at most a minute and a half in all", () => {
		expect(POLL_DELAYS_MS.length).toBeLessThanOrEqual(8);
		expect(POLL_DELAYS_MS[0]).toBeGreaterThanOrEqual(3000);
		for (let i = 1; i < POLL_DELAYS_MS.length; i++) {
			expect(POLL_DELAYS_MS[i]).toBeGreaterThanOrEqual(POLL_DELAYS_MS[i - 1] as number);
		}
		expect(POLL_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(90_000);
	});

	it("EU-FR-09 stops as soon as the state changes", async () => {
		const answers = ["pending", "pending", "confirmed"];
		let calls = 0;
		const waits: number[] = [];
		const out = await pollPayment({
			fetchState: async () => answers[calls++] ?? "pending",
			wait: async (ms) => void waits.push(ms),
			isHidden: () => false,
		});
		expect(out).toEqual({ result: "changed", state: "confirmed" });
		expect(calls).toBe(3);
		expect(waits).toEqual(POLL_DELAYS_MS.slice(0, 3));
	});

	it("EU-FR-09 gives up after the schedule so the page can say we will email", async () => {
		let calls = 0;
		const out = await pollPayment({
			fetchState: async () => {
				calls++;
				return "pending";
			},
			wait: noWait,
			isHidden: () => false,
		});
		expect(out).toEqual({ result: "gave_up" });
		expect(calls).toBe(POLL_DELAYS_MS.length);
	});

	it("EU-FR-09 does not fetch while the tab is hidden, and stops on an error", async () => {
		let hiddenChecks = 0;
		let calls = 0;
		await pollPayment({
			fetchState: async () => {
				calls++;
				return "pending";
			},
			wait: noWait,
			// hidden on the first check of every round, visible on the second
			isHidden: () => ++hiddenChecks % 2 === 1,
		});
		expect(calls).toBe(POLL_DELAYS_MS.length);
		const failed = await pollPayment({ fetchState: async () => null, wait: noWait, isHidden: () => false });
		expect(failed).toEqual({ result: "gave_up" });
	});
});

describe("the pages (EU-FR-09, T057)", () => {
	it("EU-FR-09 the return component is a polite live region with no-JS fallbacks", () => {
		const component = source("../../src/astro/PaymentReturn.astro");
		expect(component).toContain('role="status"');
		expect(component).toContain('aria-live="polite"');
		expect(component).toContain("data-semics-payment");
		expect(component).toContain("Check again");
		expect(component).toContain('value="resume"');
	});

	it("EU-FR-09 the booking page renders it, ignores Stripe's session_id, and checks Origin before the resume form", () => {
		const page = source("../../src/astro/BookingPage.astro");
		expect(page).toContain("<PaymentReturn");
		expect(page).not.toContain("session_id");
		expect(page).toContain('"resume"');
		const guard = page.indexOf("isCrossSiteRequest(Astro.request");
		expect(guard).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(page.indexOf("Astro.request.formData()"));
		expect(guard).toBeLessThan(page.indexOf("resumePayment("));
	});

	it("EU-FR-09 the component is exported for sites that lay out their own booking page", () => {
		expect(source("../../package.json")).toContain('"./astro/PaymentReturn.astro"');
		expect(source("../../src/astro/index.js")).toContain("PaymentReturn");
	});
});
