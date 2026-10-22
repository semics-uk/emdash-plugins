import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

// T078 (Phase 4 gate, EV-FR-13, EV-FR-14): the Free side of paid booking, in a real browser against
// the real server. The playground runs the Free cores only (R40), so the paid journey itself (reserve
// with a code → Stripe → webhook → confirmed, refunds, R2, waiver then pay, downgrade) is proven on the
// Pro bundle in the Pro repo (`events-pro/tests/payments-e2e.editions.test.ts`), driving the same UI
// code these pages run. What this covers:
//  - a Free event page offers no promo code field (Free has no codes) and books as before;
//  - `/e2e/promo` renders the real <BookingWidget> as a Pro site shows it (`promoCodes: true`, and with
//    `?applied=1` an unlock code's hidden type), so the field, its own form, the hidden types and the
//    no-JS and JS behaviour are real; "Apply code" posts to the real `/_events/promo`, whose
//    `public/promo/check` reaches the Free core (no such route: the code is refused, never in a URL);
//  - cross-site posts to `/_events/promo` and the booking page's "Pay now" are refused (CSRF);
//  - Free answers a Stripe webhook delivery with 503, so Stripe keeps a payment made after a downgrade.

const PROMO = "/e2e/promo";

async function noJs(browser: Browser) {
	const context = await browser.newContext({ javaScriptEnabled: false });
	return { context, page: await context.newPage() };
}

async function seriousViolations(page: Page) {
	const results = await new AxeBuilder({ page }).include(".semics-events").analyze();
	return results.violations
		.filter((v) => v.impact === "serious" || v.impact === "critical")
		.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("EV-FR-14 a Free event page has no promo code field", async ({ page }) => {
	await page.goto("/events/london-meetup");
	const widget = page.getByTestId("booking-widget");
	await expect(widget.getByRole("button", { name: "Book" })).toBeVisible();
	await expect(widget.getByLabel("Promo code")).toHaveCount(0);
	await expect(widget.locator('input[name="promoCode"]')).toHaveCount(0);
});

test("EV-FR-14 the Pro widget: the code field has its own form, and an applied unlock code adds the hidden type", async ({
	page,
}) => {
	await page.goto(`${PROMO}?applied=1`);
	const widget = page.getByTestId("booking-widget");
	const field = widget.getByLabel("Promo code");
	await expect(field).toHaveValue("VIP-PASS");
	await expect(field).toHaveAttribute("form", /promo-form$/);
	await expect(widget.getByTestId("promo-note")).toHaveText("Code applied: more tickets are now available.");
	await expect(widget.getByLabel(/Backstage/)).toBeVisible();
	// The order carries the applied code in a field of its own form, not the visible one.
	const order = widget.locator("form[data-semics-booking]");
	await expect(order.locator('input[type="hidden"][name="promoCode"]')).toHaveValue("VIP-PASS");
	expect(await seriousViolations(page)).toEqual([]);
});

test("EV-FR-14 no JS: Apply posts the code, a refused code comes back on its field, never in the URL", async ({
	browser,
}) => {
	const { context, page } = await noJs(browser);
	await page.goto(PROMO);
	const widget = page.getByTestId("booking-widget");
	await widget.getByLabel("Promo code").fill("SECRET-VIP-CODE");
	await widget.getByRole("button", { name: "Apply code" }).click();

	await expect(page).toHaveURL(/booking_error=PROMO_INVALID/);
	expect(page.url()).not.toContain("SECRET");
	expect(new URL(page.url()).searchParams.get("booking_fields")).toBe("promo");
	await expect(widget.getByLabel("Promo code")).toHaveAttribute("aria-invalid", "true");
	await expect(widget.locator("[data-form-alert]")).toHaveText("That code is not valid for this event.");
	const cookies = await context.cookies();
	expect(cookies.filter((c) => c.name.startsWith("semics_promo_"))).toEqual([]);
	await context.close();
});

test("EV-FR-14 with JS: Enter in the order's fields books (not Apply), and Apply is not blocked by the order's checks", async ({
	page,
}) => {
	await page.goto(PROMO);
	const widget = page.getByTestId("booking-widget");
	// Enter in the email field submits the order: the script's checks run and nothing is sent.
	await widget.getByLabel("Email").fill("not-an-email");
	await widget.getByLabel("Email").press("Enter");
	await expect(widget.locator('[data-error-for="name"]')).toHaveText("Enter your name.");
	await expect(page).toHaveURL(new RegExp(`${PROMO}$`));
	// Enter in the code field applies the code, with the order still empty.
	await widget.getByLabel("Promo code").fill("ANOTHER-CODE");
	await widget.getByLabel("Promo code").press("Enter");
	await expect(page).toHaveURL(/booking_error=PROMO_INVALID/);
	expect(page.url()).not.toContain("ANOTHER");
});

test("EV-NFR-05 cross-site posts to /_events/promo and the booking page's Pay now are refused", async ({ request }) => {
	const promo = await request.post("/_events/promo", {
		form: { eventId: "e2e-promo", promoCode: "VIP-PASS", returnTo: "/e2e/promo" },
		headers: { "sec-fetch-site": "cross-site" },
		maxRedirects: 0,
	});
	expect(promo.status()).toBe(403);
	expect(promo.headers()["set-cookie"] ?? "").not.toContain("semics_promo_");
	const resume = await request.post("/booking?ref=ABCDEFGHJK", {
		form: { intent: "resume" },
		headers: { "sec-fetch-site": "cross-site" },
		maxRedirects: 0,
	});
	expect(resume.status()).toBe(403);
});

test("EV-FR-13 R2 Free answers a Stripe webhook delivery with 503, so Stripe redelivers once Pro is back", async ({
	request,
}) => {
	const res = await request.post("/_emdash/api/plugins/semics-events/webhooks/stripe", {
		data: '{"id":"evt_1","type":"checkout.session.completed"}',
		headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
	});
	expect(res.status()).toBe(503);
	expect(await res.text()).toContain("WEBHOOK_NOT_HANDLED");
});
