import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// T082 (EV-FR-11, EV-FR-12): the staff check-in screen at /_events/check-in and the pass QR. The
// playground runs the Free core, which has no `checkin/code` route, so the Pro answers are played by
// a route mock; the Free answer is the real one.

const API = "**/_emdash/api/plugins/semics-events/checkin/code";

async function phone(page: Page) {
	await page.setViewportSize({ width: 320, height: 640 });
	await page.goto("/_events/check-in");
}

async function enter(page: Page, code: string) {
	await page.getByLabel("Check-in code").fill(code);
	await page.getByRole("button", { name: "Check in" }).click();
}

test("EV-FR-11 the check-in screen works at 320 px: no sideways scrolling, every control reachable, no axe violations", async ({
	page,
}) => {
	const response = await page.request.get("/_events/check-in");
	expect(response.headers()["referrer-policy"]).toBe("no-referrer");
	expect(response.headers()["cache-control"]).toContain("no-store");
	await phone(page);
	await expect(page.getByRole("heading", { name: "Check in" })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
	for (const control of [page.getByLabel("Check-in code"), page.getByRole("button", { name: "Check in" })]) {
		const box = await control.boundingBox();
		expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
		// Thumb-sized targets (WCAG 2.5.8 asks 24 px; the screen uses 44).
		expect(box && box.height >= 44).toBe(true);
	}
	expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("EV-FR-11 a successful check-in shows the attendee's name", async ({ page }) => {
	await page.route(API, (route) =>
		route.fulfill({
			json: { success: true, data: { ok: true, checkedIn: true, name: "Ada Lovelace", checkedInAt: new Date().toISOString() } },
		}),
	);
	await phone(page);
	await enter(page, "q3Zx_9-AbCdEf");
	await expect(page.getByTestId("checkin-result")).toHaveAttribute("data-tone", "ok");
	await expect(page.getByTestId("checkin-result")).toContainText("Checked in: Ada Lovelace");
	// Ready for the next attendee: the field is cleared and focused.
	await expect(page.getByLabel("Check-in code")).toHaveValue("");
	await expect(page.getByLabel("Check-in code")).toBeFocused();
});

test("EV-FR-12 pending waivers show the sign link, at 320 px", async ({ page }) => {
	let body: unknown;
	await page.route(API, async (route) => {
		body = route.request().postDataJSON();
		const origin = new URL(route.request().url()).origin;
		await route.fulfill({
			json: {
				success: true,
				data: {
					ok: true,
					checkedIn: false,
					reason: "WAIVER_PENDING",
					name: "Charles Babbage",
					signLink: `${origin}/_events/sign#intent=abc.def&lookup=ghi`,
				},
			},
		});
	});
	await phone(page);
	await enter(page, " charles-code ");
	expect(body).toEqual({ code: "charles-code" });
	const result = page.getByTestId("checkin-result");
	await expect(result).toHaveAttribute("data-tone", "error");
	await expect(result).toContainText("Waiver not signed");
	const link = page.getByRole("link", { name: "Open the signing page" });
	await expect(link).toBeVisible();
	expect(await link.getAttribute("href")).toMatch(/\/_events\/sign#intent=abc\.def&lookup=ghi$/);
	const box = await link.boundingBox();
	expect(box && box.x + box.width <= 320).toBe(true);
	expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("T049 a booking that is not confirmed is refused, and a foreign sign link is never shown", async ({ page }) => {
	await page.route(API, (route) =>
		route.fulfill({
			json: {
				success: true,
				data: {
					ok: true,
					checkedIn: false,
					reason: "BOOKING_NOT_CONFIRMED",
					bookingStatus: "cancelled",
					name: "Ada",
					signLink: "https://evil.example/_events/sign#intent=x",
				},
			},
		}),
	);
	await phone(page);
	await enter(page, "abc");
	await expect(page.getByTestId("checkin-result")).toContainText("cancelled");
	await expect(page.getByRole("link", { name: "Open the signing page" })).toHaveCount(0);
});

test("EV-FR-11 on the Free core the screen says it needs Events Pro (or a sign-in)", async ({ page }) => {
	await phone(page);
	await enter(page, "abc");
	await expect(page.getByTestId("checkin-result")).toHaveAttribute("data-tone", "error");
	await expect(page.getByTestId("checkin-result")).toContainText(/Events Pro|Sign in/);
});

test("EV-FR-11 a ticket pass with a QR draws it as an SVG that fits at 320 px", async ({ browser }) => {
	// Without JavaScript: the same page's Turnstile test widget (300 px plus margins) is not the pass.
	const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
	const page = await context.newPage();
	await page.goto("/e2e/widgets");
	const qr = page.getByTestId("ticket-qr");
	await expect(qr).toBeVisible();
	await expect(qr).toHaveAttribute("role", "img");
	const box = await qr.boundingBox();
	expect(box && box.width >= 120 && box.x + box.width <= 320).toBe(true);
	expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
	await context.close();
});
