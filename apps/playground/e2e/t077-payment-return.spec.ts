import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// T077 (EU-FR-09): the payment redirect and the return page. The playground runs the Free cores
// only, so there is no Stripe and no paid booking. What this covers:
//  - `/e2e/payment` renders the REAL <BookingStatus>, <PaymentReturn> and polling script for a booking
//    whose status is faked by `?state=` (standing in for the core's `public/booking` answer);
//  - Stripe is faked: the "Pay now" post redirects to https://checkout.stripe.test/..., which these
//    tests answer themselves with a page that "returns" the buyer, with Stripe's `session_id` appended;
//  - polling is exercised with a faked clock and a faked second answer.
// Not covered here: Pro's `next: { type: "pay" }`, a real Stripe session and the BookingPage wiring (unit
// tests in packages/events/tests/ui/payment*.test.ts and packages/events-suite/tests/flow.test.ts).

const PAGE = "/e2e/payment";
const STRIPE = "https://checkout.stripe.test/**";

/** Moves the faked clock in small steps, letting real fetches settle between them (polling awaits the network). */
async function advance(page: Page, ms: number) {
	for (let spent = 0; spent < ms; spent += 500) {
		await page.clock.runFor(500);
		await page.waitForTimeout(40);
	}
}

async function serious(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	return results.violations
		.filter((v) => v.impact === "serious" || v.impact === "critical")
		.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const OUTCOMES: Array<[string, string, RegExp]> = [
	["confirmed", "confirmed", /Payment received/],
	["awaiting_payment", "pending", /Waiting for your payment/],
	["expired", "expired", /This booking expired/],
	["cancelled", "cancelled", /Booking cancelled/],
	["refunded", "refunded", /Payment refunded$/],
	["refunded_unavailable", "refunded_unavailable", /tickets no longer available/],
];

for (const [status, state, heading] of OUTCOMES) {
	test(`EU-FR-09 the return page shows ${status} and has no serious accessibility violations`, async ({ page }) => {
		await page.goto(`${PAGE}?state=${status}`);
		const region = page.getByTestId("payment-return");
		await expect(region).toHaveAttribute("data-state", state);
		await expect(region.getByRole("heading", { level: 2 })).toHaveText(heading);
		await expect(region.getByRole("status")).toBeVisible();
		expect(await serious(page)).toEqual([]);
	});
}

test("EU-FR-09 a refund after a sell-out says no tickets were issued, in plain words", async ({ page }) => {
	await page.goto(`${PAGE}?state=refunded_unavailable`);
	await expect(page.getByTestId("payment-message")).toContainText("refunded in full");
	await expect(page.getByTestId("payment-message")).toContainText("No tickets were issued");
	await expect(page.getByTestId("payment-resume")).toHaveCount(0);
});

test("EU-FR-09 abandoned at Stripe: pay now goes to the provider; coming back shows the held booking", async ({
	page,
	context,
	request,
	baseURL,
}) => {
	await context.route(STRIPE, (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<!doctype html><html lang="en"><title>Fake Stripe</title><main><h1>Fake Stripe Checkout</h1>
				<a href="${baseURL}/e2e/payment?state=awaiting_payment&session_id=cs_test_1">Back to the site</a></main></html>`,
		}),
	);
	// Chrome does not hand a server redirect's hop to Playwright's routes, so the redirect is checked on
	// the response itself and the browser then opens the faked Stripe page directly.
	const resume = await request.post(`${PAGE}?state=awaiting_payment`, {
		form: { intent: "resume" },
		maxRedirects: 0,
	});
	expect(resume.status()).toBe(303);
	const stripeUrl = resume.headers().location ?? "";
	expect(stripeUrl).toBe("https://checkout.stripe.test/c/pay/cs_test_1");
	await page.goto(`${PAGE}?state=awaiting_payment`);
	await expect(page.getByTestId("payment-resume")).toBeVisible();
	await page.goto(stripeUrl);
	await page.getByRole("link", { name: "Back to the site" }).click();

	// `session_id` is in the URL, and changes nothing: the state is the core's.
	await expect(page).toHaveURL(/session_id=cs_test_1/);
	const region = page.getByTestId("payment-return");
	await expect(region).toHaveAttribute("data-state", "pending");
	await expect(region.getByTestId("payment-message")).toContainText("held until");
	await expect(page.getByTestId("payment-resume")).toBeVisible();
	await expect(page.getByRole("link", { name: "Check again" })).toBeVisible();
});

test("EU-FR-09 paid but the webhook is late: the page polls, then shows the confirmed booking", async ({ page }) => {
	await page.clock.install();
	let requests = 0;
	await page.route("**/e2e/payment?state=awaiting_payment", async (route) => {
		requests++;
		// Request 1 is the visit, 2 the first poll (still pending), later ones (poll, reload) are confirmed.
		if (requests <= 2) return route.continue();
		const response = await route.fetch({ url: route.request().url().replace("awaiting_payment", "confirmed") });
		return route.fulfill({ response });
	});
	await page.goto(`${PAGE}?state=awaiting_payment`);
	await expect(page.getByTestId("payment-checking")).toBeVisible();
	await advance(page, 3500);
	await expect(page.getByTestId("payment-return")).toHaveAttribute("data-state", "pending");
	await advance(page, 5500);
	await advance(page, 2000);
	await expect(page.getByTestId("payment-return")).toHaveAttribute("data-state", "confirmed");
	expect(requests).toBeGreaterThanOrEqual(3);
});

test("EU-FR-09 paid but never confirmed in time: polling stops and the page says we will email", async ({ page }) => {
	await page.clock.install();
	let requests = 0;
	await page.route("**/e2e/payment?state=awaiting_payment", (route) => {
		requests++;
		return route.continue();
	});
	await page.goto(`${PAGE}?state=awaiting_payment`);
	await expect(page.getByTestId("payment-slow")).toBeHidden();
	await advance(page, 90_000);
	await expect(page.getByTestId("payment-slow")).toBeVisible();
	await expect(page.getByTestId("payment-slow")).toContainText("we will email you");
	await expect(page.getByTestId("payment-checking")).toBeHidden();
	// The visit plus six polls at most, then nothing more.
	expect(requests).toBeLessThanOrEqual(7);
	await advance(page, 30_000);
	expect(requests).toBeLessThanOrEqual(7);
	expect(await serious(page)).toEqual([]);
});

test("EU-FR-09 no JavaScript: the pending page still offers Pay now and Check again, and shows no spinner text", async ({
	browser,
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto(`${PAGE}?state=awaiting_payment`);
	await expect(page.getByTestId("payment-resume")).toBeVisible();
	await expect(page.getByTestId("payment-check")).toHaveAttribute("href", /\/booking\?ref=ABCDEFGHJK$/);
	await expect(page.getByTestId("payment-checking")).toBeHidden();
	await expect(page.getByTestId("payment-slow")).toBeHidden();
	await context.close();
});

test("EU-FR-09 keyboard: Pay now is reachable and the 'Pay now' post is refused from another site", async ({
	page,
	request,
}) => {
	await page.goto(`${PAGE}?state=awaiting_payment`);
	await page.keyboard.press("Tab");
	await page.keyboard.press("Tab");
	await expect(page.getByTestId("payment-resume")).toBeFocused();

	const cross = await request.post(`${PAGE}?state=awaiting_payment`, {
		form: { intent: "resume" },
		headers: { "sec-fetch-site": "cross-site" },
		maxRedirects: 0,
	});
	expect(cross.status()).toBe(403);
});

test("EU-FR-09 the real booking page ignores Stripe's session_id and never shows a booking without the cookie", async ({
	page,
}) => {
	await page.goto("/booking?ref=ABCDEFGHJK&session_id=cs_test_1");
	await expect(page.getByTestId("booking-missing")).toBeVisible();
	await expect(page.getByTestId("payment-return")).toHaveCount(0);
});
