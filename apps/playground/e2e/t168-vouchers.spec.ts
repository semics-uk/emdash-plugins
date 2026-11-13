import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

import { CHECKOUT_HOST, type FakeStripe, SECRET_KEY, type Session, startFakeStripe, WEBHOOK_SECRET } from "./harness/fake-stripe";
import {
	address,
	BOOKING_URL,
	bookingByRef,
	createEvent,
	linkIn,
	mailTo,
	patchBooking,
	runCron,
	saveSettings,
	stripePort,
} from "./harness/pro";
import {
	CODE,
	hasVouchers,
	lapseHolds,
	pairVouchers,
	redemptionsOf,
	requireVouchers,
	saveVoucherSettings,
	VOUCHERS,
	voucherState,
} from "./harness/vouchers";

// T168 (T163 §4–§6) on the playground built with Events Pro and Vouchers Pro (EMDASH_PRO_DIR), Stripe faked as in
// T135/T159 (the server's Stripe calls reach e2e/harness/fake-stripe.ts; the spec signs the deliveries Stripe would
// send and posts them to the site's one endpoint, /_semics/stripe, which routes them by metadata.plugin).
//  1. buy a £50 voucher through <BuyVoucher>, get the code by email, open the voucher page and print it (A4);
//  2. redeem it for the whole of a £30 booking (nothing to pay);
//  3. part-pay: the £20 left, and Stripe the other £10;
//  4. a cancelled booking puts its £30 back on the voucher;
//  5. two bookings racing for one £30 balance: one gets it, the other is refused;
//  6. an abandoned checkout's hold is freed on the code's next use;
//  7. a mistyped code is refused on the form: nothing reserved, no "cancelled" email.
// Skipped on the Free build (CI), which has neither.

test.describe.configure({ mode: "serial" });

const SLUG = "t168-clay-taster";
const TICKET = "Taster session";
const PRICE = 3000;
let stripe: FakeStripe | undefined;

test.beforeAll(async ({ request }) => {
	if (!(await hasVouchers(request))) return;
	stripe = await startFakeStripe(stripePort());
	// One Stripe account and one webhook endpoint for the site: both plugins hold the same keys (T163 §1, §4a).
	await saveVoucherSettings(request, { stripeSecretKey: SECRET_KEY, stripeWebhookSecret: WEBHOOK_SECRET });
	await saveSettings(request, { stripeSecretKey: SECRET_KEY, stripeWebhookSecret: WEBHOOK_SECRET });
	await pairVouchers(request);
	await createEvent(request, {
		slug: SLUG,
		title: "Clay Taster",
		startsAt: "2031-07-04T10:00:00.000Z",
		config: { status: "on_sale", capacity: 40, currency: "GBP", signature: { required: false } },
		ticketTypes: [{ name: TICKET, priceMinor: PRICE, capacity: 40, maxPerOrder: 4 }],
	});
});

test.afterAll(async () => {
	await stripe?.close();
});

async function visitor(browser: Browser) {
	const context = await browser.newContext({
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	// Stripe's Checkout page is never loaded: the spec plays the buyer's part there.
	await context.route(`${CHECKOUT_HOST}/**`, (route) =>
		route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Checkout (fake)</title>" }),
	);
	return { context, page: await context.newPage() };
}

/** Runs `act` and returns the Checkout Session the site sent the browser to. */
async function toCheckout(page: Page, act: () => Promise<unknown>): Promise<Session> {
	const [request] = await Promise.all([page.waitForRequest((r) => r.url().startsWith(`${CHECKOUT_HOST}/c/`)), act()]);
	const session = stripe?.sessions.get(new URL(request.url()).pathname.split("/").at(-1) as string);
	expect(session, "the session the site created").toBeTruthy();
	return session as Session;
}

/** What Stripe does when the buyer pays: the signed delivery to the site's one endpoint. */
async function paid(request: APIRequestContext, session: Session) {
	const { body, signature } = (stripe as FakeStripe).complete(session);
	const res = await request.post("/_semics/stripe", {
		data: body,
		headers: { "content-type": "application/json", "stripe-signature": signature },
	});
	expect(res.status(), await res.text()).toBe(200);
}

/** Buys a money voucher of `amount` pence through <BuyVoucher>; returns its code (from the buyer's email). */
async function buy(browser: Browser, request: APIRequestContext, amount: number, buyer = address("buyer")) {
	const { context, page } = await visitor(browser);
	await page.goto("/e2e/vouchers");
	const form = page.getByTestId("buy-voucher");
	await form.getByLabel("Money voucher").check();
	const preset = form.getByRole("radio", { name: `£${amount / 100}`, exact: true });
	if (await preset.count()) await preset.check();
	else {
		await form.getByLabel("Another amount").check();
		await form.getByLabel("Amount (£)").fill(String(amount / 100));
	}
	await form.getByLabel("Recipient's name").fill("James");
	await form.getByLabel("Your name").fill("Grace Hopper");
	await form.getByLabel("Your email").fill(buyer);
	await form.getByLabel("Personal message").fill("Have a brilliant day out!");
	// The live preview follows what is typed.
	await expect(page.getByTestId("voucher-preview")).toContainText("James");
	const session = await toCheckout(page, () => form.getByRole("button", { name: /Buy/ }).click());
	expect(session.form.get("metadata[plugin]")).toBe("vouchers");
	expect(session.amount).toBe(amount);
	await paid(request, session);
	const back = new URL(session.form.get("success_url") as string);
	await page.goto(`${back.pathname}${back.search}`);
	await expect(page.getByTestId("voucher-thanks")).toContainText(/Thank you/);
	await context.close();
	const mail = await mailTo(request, buyer, /gift voucher/i, "semics-vouchers");
	const code = CODE.exec(mail.text)?.[0];
	expect(code, "a code in the receipt").toBeTruthy();
	return { code: code as string, link: linkIn(mail, "/_vouchers/v") };
}

/** Books one ticket on the event page with the code; `pay` stops on Checkout and returns the session. */
async function book(page: Page, code: string, email: string) {
	await page.goto(`/events/${SLUG}`);
	const widget = page.getByTestId("booking-widget");
	await widget.getByLabel(new RegExp(TICKET)).fill("1");
	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Email").fill(email);
	await widget.getByLabel("Gift voucher code").fill(code);
	return widget;
}

const refOf = (page: Page) => BOOKING_URL.exec(page.url())?.[1] as string;

let first: { code: string; link: string };
let fullRef = "";
let fullPage: Page | undefined;

test("T168 R16 buy a voucher through <BuyVoucher>, open the voucher page and print it on A4", async ({ browser, request }) => {
	await requireVouchers(request);
	first = await buy(browser, request, 5000);
	expect(await voucherState(request, first.code)).toMatchObject({ balanceMinor: 5000, heldMinor: 0, status: "active" });

	const { context, page } = await visitor(browser);
	const res = await page.goto(first.link);
	expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
	const card = page.getByTestId("voucher-card");
	await expect(card).toContainText(first.code);
	await expect(card).toContainText("£50.00");
	await expect(card).toContainText("James");
	await expect(card).toContainText("Have a brilliant day out!");
	await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
	await page.emulateMedia({ media: "print" });
	await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
	const pdf = await page.pdf({ format: "A4", printBackground: true });
	const text = pdf.toString("latin1");
	expect(text.match(/\/Type\s*\/Page[^s]/g)?.length, "one A4 page").toBe(1);
	expect(text).toMatch(/\/MediaBox\s*\[\s*0 0 595(\.\d+)? 841(\.\d+)?\s*\]/);
	await context.close();
});

test("T168 R16 redeem the whole of a booking: nothing to pay, the voucher line on the booking page", async ({ browser, request }) => {
	await requireVouchers(request);
	const { page } = await visitor(browser);
	const widget = await book(page, first.code, address("full"));
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(BOOKING_URL);
	fullRef = refOf(page);
	fullPage = page;
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("booking-voucher")).toContainText("£30.00");
	// The booking page settled the hold: spent, not just held.
	expect(await voucherState(request, first.code)).toMatchObject({ balanceMinor: 2000, heldMinor: 0 });
	expect(redemptionsOf(fullRef)).toMatchObject([{ state: "confirmed", amountMinor: 3000 }]);
});

test("T168 R16 part-pay: the £20 left on the voucher, and Stripe the other £10", async ({ browser, request }) => {
	await requireVouchers(request);
	const { context, page } = await visitor(browser);
	const widget = await book(page, first.code, address("part"));
	const session = await toCheckout(page, () => widget.getByRole("button", { name: "Book" }).click());
	expect(session.amount).toBe(1000);
	expect(session.form.get("metadata[plugin]")).toBe("events");
	await paid(request, session);
	const back = new URL(session.form.get("success_url") as string);
	await page.goto(`${back.pathname}${back.search}`);
	await expect(page).toHaveURL(BOOKING_URL);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("booking-voucher")).toContainText("£20.00");
	expect(await voucherState(request, first.code)).toMatchObject({ balanceMinor: 0, heldMinor: 0, status: "spent" });
	await context.close();
});

test("T168 R16 a cancelled booking puts what the voucher paid back on the voucher", async ({ request }) => {
	await requireVouchers(request);
	const page = fullPage as Page;
	await page.goto(`/booking?ref=${fullRef}`);
	await page.getByTestId("booking-cancel").getByText("Cancel booking").click();
	await page.getByRole("button", { name: "Yes, cancel this booking" }).click();
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "cancelled");
	// The cancelled page settles the hold as credited (back to the voucher, not the card), and the expiry stays.
	await expect.poll(async () => (await voucherState(request, first.code)).balanceMinor).toBe(3000);
	expect(redemptionsOf(fullRef)).toMatchObject([{ state: "credited", creditedMinor: 3000 }]);
	await page.context().close();
});

test("T168 R16 two bookings racing for one balance: one gets it, the other is refused", async ({ browser, request }) => {
	await requireVouchers(request);
	const { code } = await buy(browser, request, 3000);
	const a = await visitor(browser);
	const b = await visitor(browser);
	const [wa, wb] = [await book(a.page, code, address("race-a")), await book(b.page, code, address("race-b"))];
	await Promise.all([
		wa.getByRole("button", { name: "Book" }).click(),
		wb.getByRole("button", { name: "Book" }).click(),
	]);
	await Promise.all([a.page.waitForLoadState("load"), b.page.waitForLoadState("load")]);
	const won = [a.page, b.page].filter((p) => BOOKING_URL.test(p.url()));
	const lost = [a.page, b.page].filter((p) => !BOOKING_URL.test(p.url()));
	expect(won).toHaveLength(1);
	expect(lost).toHaveLength(1);
	await expect(won[0]?.getByTestId("booking-voucher") as never).toContainText("£30.00");
	await expect(lost[0]?.getByTestId("booking-widget") as never).toContainText(/nothing left to spend/);
	const state = await voucherState(request, code);
	expect(state.balanceMinor).toBe(0);
	expect(state.heldMinor).toBe(0);
	await a.context.close();
	await b.context.close();
});

test("T168 R16 an abandoned checkout's hold is freed on the code's next use", async ({ browser, request }) => {
	await requireVouchers(request);
	const { code } = await buy(browser, request, 2000);
	const left = await visitor(browser);
	const widget = await book(left.page, code, address("abandon"));
	const abandoned = await toCheckout(left.page, () => widget.getByRole("button", { name: "Book" }).click());
	expect(abandoned.amount).toBe(1000);
	const ref = abandoned.form.get("metadata[bookingRef]") as string;
	expect(await voucherState(request, code)).toMatchObject({ balanceMinor: 0, heldMinor: 2000 });
	await left.context.close();

	// The buyer never pays: half an hour later the booking's hold has lapsed and so has the voucher's.
	patchBooking(bookingByRef(ref).id, { holdExpiresAt: new Date(Date.now() - 60_000).toISOString() });
	await runCron(request, "sweep-holds");
	lapseHolds(code.slice(-4));

	const next = await visitor(browser);
	const again = await book(next.page, code, address("next"));
	const session = await toCheckout(next.page, () => again.getByRole("button", { name: "Book" }).click());
	// The lookup asked Events about the abandoned booking, settled it as released, and the hold was taken again.
	expect(session.amount).toBe(1000);
	expect(redemptionsOf(ref)).toMatchObject([{ state: "released" }]);
	expect(await voucherState(request, code)).toMatchObject({ balanceMinor: 0, heldMinor: 2000 });
	await next.context.close();
});

test("T168 R16 a mistyped code is refused on the form: nothing reserved, no cancelled email", async ({ browser, request }) => {
	await requireVouchers(request);
	const email = address("typo");
	const { context, page } = await visitor(browser);
	const widget = await book(page, "QQQQ-0000-QQQQ-0000", email);
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(new RegExp(`/events/${SLUG}`));
	await expect(widget.locator('[data-error-for="voucher"]')).toHaveText("Check the code, or leave it empty.");
	expect(page.url()).not.toContain("QQQQ");
	await runCron(request, "outbox-drain");
	const { messages } = (await (await request.get(`/e2e/mail?to=${encodeURIComponent(email)}`)).json()) as {
		messages: unknown[];
	};
	expect(messages).toEqual([]);
	await context.close();
});
