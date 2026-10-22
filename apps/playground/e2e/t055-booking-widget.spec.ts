import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

// T055 (EU-FR-04, EU-FR-06..08, EU-NFR-01..07): the booking widget, status, pass and calendar.
// The london-meetup event is on sale with free tickets (e2e/harness/fixtures.mjs).

const EVENT = "/events/london-meetup";
const KEY = /^[A-Za-z0-9_-]{32,128}$/;

async function noJs(browser: Browser, width?: number) {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		...(width ? { viewport: { width, height: 800 } } : {}),
	});
	return { context, page: await context.newPage() };
}

async function fillOrder(page: Page, name: string, email: string) {
	await page.getByLabel(/General admission/).fill("2");
	await page.getByLabel("Your name").fill(name);
	await page.getByLabel("Email").fill(email);
}

async function seriousViolations(page: Page) {
	const results = await new AxeBuilder({ page }).include(".semics-events").analyze();
	return results.violations
		.filter((v) => v.impact === "serious" || v.impact === "critical")
		.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("EU-FR-04 no-JS booking completes (Turnstile off) and shows the confirmed booking", async ({ browser }) => {
	const { context, page } = await noJs(browser);
	await page.goto(EVENT);
	const widget = page.getByTestId("booking-widget");
	await expect(widget.getByRole("heading", { name: "Book tickets" })).toBeVisible();
	await expect(widget.locator('input[name="idempotencyKey"]')).toHaveValue(KEY);
	await fillOrder(page, "Ada Lovelace", "ada@example.com");
	await widget.getByRole("button", { name: "Book" }).click();

	await expect(page).toHaveURL(/\/booking\?ref=[0-9A-Z]{10}$/);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("booking-status")).toContainText("Confirmed");
	await context.close();
});

test("EU-FR-04 each page load gets a fresh idempotency key, and a resubmit reuses it", async ({ page }) => {
	await page.goto(EVENT);
	const key = page.locator('[data-testid="booking-widget"] input[name="idempotencyKey"]');
	const first = await key.inputValue();
	await page.reload();
	const second = await key.inputValue();
	expect(first).toMatch(KEY);
	expect(second).toMatch(KEY);
	expect(second).not.toBe(first);

	// The client keeps one key for the life of the page: a second submit sends the same one.
	const sent: string[] = [];
	await page.route("**/_events/checkout", async (route) => {
		sent.push(new URLSearchParams(route.request().postData() ?? "").get("idempotencyKey") ?? "");
		await route.fulfill({ status: 204 });
	});
	await fillOrder(page, "Ada", "ada@example.com");
	const form = page.locator("form[data-semics-booking]");
	for (let i = 0; i < 2; i++) {
		await form.evaluate((f: HTMLFormElement) => {
			delete f.dataset.submitting;
			f.requestSubmit();
		});
		await expect.poll(() => sent.length).toBe(i + 1);
	}
	expect(sent[0]).toBe(second);
	expect(sent[1]).toBe(second);
});

test("EU-FR-04 with Turnstile on and JS off, the widget explains scripts are needed", async ({ browser }) => {
	const { context, page } = await noJs(browser);
	await page.goto("/e2e/widgets");
	const widget = page.getByTestId("booking-widget");
	await expect(widget.getByTestId("booking-needs-js")).toBeVisible();
	await expect(widget.getByTestId("booking-needs-js")).toContainText("JavaScript");
	await expect(widget.getByRole("button", { name: "Book" })).toBeDisabled();
	await context.close();
});

test("EU-NFR-03 errors render next to their fields (no JS: after the round trip)", async ({ browser }) => {
	const { context, page } = await noJs(browser);
	await page.goto(EVENT);
	// Whitespace passes the browser's `required` check; the server trims it and says why.
	await page.getByLabel("Your name").fill("   ");
	await page.getByLabel("Email").fill("ada@example.com");
	await page.getByTestId("booking-widget").getByRole("button", { name: "Book" }).click();

	await expect(page).toHaveURL(/booking_error=BAD_REQUEST/);
	const widget = page.getByTestId("booking-widget");
	await expect(widget.getByRole("alert")).toBeVisible();
	const name = page.getByLabel("Your name");
	await expect(name).toHaveAttribute("aria-invalid", "true");
	const nameError = page.locator(`#${await name.getAttribute("aria-describedby")}`);
	await expect(nameError).toHaveText("Enter your name.");
	const tickets = widget.getByRole("group", { name: "Tickets" });
	await expect(tickets).toHaveAttribute("aria-invalid", "true");
	await expect(page.locator(`#${await tickets.getAttribute("aria-describedby")}`)).toHaveText(
		"Choose at least one ticket.",
	);
	await expect(page.getByLabel("Email")).not.toHaveAttribute("aria-invalid", "true");
	await context.close();
});

test("EU-NFR-03 errors render next to their fields (JS: before anything is sent)", async ({ page }) => {
	await page.goto(EVENT);
	let posted = false;
	page.on("request", (r) => {
		if (r.url().includes("/_events/checkout")) posted = true;
	});
	await page.getByLabel("Email").fill("not-an-email");
	await page.getByTestId("booking-widget").getByRole("button", { name: "Book" }).click();
	const email = page.getByLabel("Email");
	await expect(email).toHaveAttribute("aria-invalid", "true");
	await expect(page.locator(`#${await email.getAttribute("aria-describedby")}`)).toHaveText(
		"Enter a valid email address.",
	);
	// Focus moves to the first field that needs attention (no tickets chosen yet).
	await expect(page.getByLabel(/General admission/)).toBeFocused();
	expect(posted).toBe(false);
	// The live total updates with the quantities.
	await page.getByLabel(/General admission/).fill("3");
	await expect(page.getByTestId("booking-total")).toBeVisible();
});

test("EU-FR-07 EU-FR-08 the pass shows the attendee code as text and the calendar link is signed", async ({
	browser,
}) => {
	const { context, page } = await noJs(browser);
	await page.goto("/e2e/widgets");
	const pass = page.getByTestId("ticket-pass");
	await expect(pass.getByTestId("ticket-code")).toHaveText("K7Q2-M9XD");
	// User content is text, never markup.
	await expect(pass).toContainText("<b>Grace</b>");
	await expect(pass.locator("b")).toHaveCount(0);
	const link = page.getByRole("link", { name: /Add to calendar/ });
	const href = (await link.getAttribute("href")) ?? "";
	expect(href).toContain("/public/booking/ics?");
	expect(href).toMatch(/[?&]sig=/);
	expect(href).toMatch(/[?&]exp=\d+/);
	expect(href).not.toMatch(/token/i);
	await context.close();
});

test("EU-NFR-01 axe finds no serious violations in the widget, status page and pass", async ({ page }) => {
	await page.goto(EVENT);
	expect(await seriousViolations(page)).toEqual([]);
	// The Turnstile widget itself is Cloudflare's; keep the run offline.
	await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
	await page.goto("/e2e/widgets");
	expect(await seriousViolations(page)).toEqual([]);

	await page.goto(EVENT);
	await fillOrder(page, "Grace Hopper", "grace@example.com");
	await page.getByTestId("booking-widget").getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(/\/booking\?ref=/);
	expect(await seriousViolations(page)).toEqual([]);
});

test("EU-NFR-04 works at 320 px: no sideways scrolling and every control reachable", async ({ browser }) => {
	const { context, page } = await noJs(browser, 320);
	for (const path of [EVENT, "/e2e/widgets"]) {
		await page.goto(path);
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow, path).toBeLessThanOrEqual(0);
		for (const control of await page.locator(".semics-events input:visible, .semics-events button").all()) {
			const box = await control.boundingBox();
			expect(box && box.x >= 0 && box.x + box.width <= 320, path).toBe(true);
		}
	}
	await context.close();
});
