import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

// T157 (Oli on LMSC staging rc.6): the booking widget is one roomy card with one attendee row and "Add another
// person", a summary above Book; the confirmed page leads with the session and can be printed or saved.
// `T157_SHOTS=1` also writes the screenshots to tasks/evidence/T157/.

const WAIVER = "/e2e/waiver-picker";
const VIEW = "/e2e/booking-view";
const SHOTS = resolve(process.cwd(), "../../tasks/evidence/T157");
const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

async function shot(page: Page, name: string, fullPage = true) {
	if (process.env.T157_SHOTS !== "1") return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage });
}

async function open(browser: Browser, path: string, viewport = DESKTOP, javaScriptEnabled = true) {
	const context = await browser.newContext({ viewport, javaScriptEnabled });
	const page = await context.newPage();
	await page.goto(path);
	return { context, page };
}

const noSideways = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("T157 the waiver widget is one card: groups have no boxes, the calendar has room", async ({ browser }) => {
	for (const [label, viewport] of [["desktop", DESKTOP], ["375", MOBILE]] as const) {
		const { context, page } = await open(browser, WAIVER, viewport);
		const widget = page.getByTestId("booking-with-waiver");
		const padding = await widget.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingInlineStart));
		expect(padding).toBeGreaterThanOrEqual(20);
		await expect(widget.locator("fieldset").first()).toHaveCSS("border-top-width", "0px");
		const days = widget.locator("button[data-day]");
		const [a, b] = [await days.nth(0).boundingBox(), await days.nth(1).boundingBox()];
		expect(a?.height ?? 0).toBeGreaterThanOrEqual(44);
		// Gaps between days, not touching cells.
		expect(Math.abs((b?.x ?? 0) - (a?.x ?? 0)) - (a?.width ?? 0)).toBeGreaterThanOrEqual(4);
		expect(await noSideways(page)).toBeLessThanOrEqual(0);
		await shot(page, `widget-${label}`);
		await days.first().click();
		await widget.locator("[data-times]:visible").getByRole("radio").nth(1).click();
		await shot(page, `widget-${label}-day-chosen`);
		await context.close();
	}
});

test("T157 one attendee row, then Add another person up to the limit; the summary sits above Book", async ({ page }) => {
	await page.goto(WAIVER);
	const widget = page.getByTestId("booking-with-waiver");
	const rows = widget.getByTestId("waiver-attendee");
	const add = widget.getByRole("button", { name: "Add another person" });
	await expect(widget.locator("[data-testid=waiver-attendee]:visible")).toHaveCount(1);
	expect(await rows.count()).toBe(4);
	await expect(widget.getByTestId("waiver-more").locator("summary")).toBeHidden();
	const summary = widget.getByTestId("waiver-summary");
	await expect(summary).toContainText("1 person");
	await widget.getByLabel("Attendee 1 Name").fill("Ada Lovelace");
	for (let n = 2; n <= 4; n++) {
		await add.click();
		await expect(widget.getByLabel(`Attendee ${n} Name`)).toBeFocused();
	}
	await expect(add).toBeHidden();
	await widget.getByLabel("Attendee 2 Name").fill("Byron Lovelace");
	await expect(summary).toContainText("2 people");
	await expect(summary).toContainText("Free");
	const book = widget.getByRole("button", { name: "Book", exact: true });
	expect((await summary.boundingBox())?.y ?? 0).toBeLessThan((await book.boundingBox())?.y ?? 0);
	const results = await new AxeBuilder({ page }).include(".semics-events").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
	expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("T157 no JavaScript: the other rows wait in Add more people, and the form posts them", async ({ browser }) => {
	const { context, page } = await open(browser, WAIVER, MOBILE, false);
	const widget = page.getByTestId("booking-with-waiver");
	await expect(widget.getByLabel("Attendee 2 Name")).toBeHidden();
	await widget.getByText(/^Add more people/).click();
	await expect(widget.getByLabel("Attendee 4 Name")).toBeVisible();
	await widget.getByLabel("Date", { exact: true }).selectOption("s-e2e-0-1");
	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Your email").fill("ada@example.com");
	await widget.getByLabel("Attendee 1 Name").fill("Ada Lovelace");
	await widget.getByLabel("Attendee 2 Name").fill("Lucy Lovelace");
	await widget.getByLabel("Attendee 2 is Under 18").check();
	await shot(page, "widget-375-no-js");
	let posted = "";
	await page.route("**/_events/waiver", async (route) => {
		posted = route.request().postData() ?? "";
		await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Waiver</title><h1>Waiver step</h1>" });
	});
	await widget.getByRole("button", { name: "Book", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Waiver step" })).toBeVisible();
	const body = new URLSearchParams(posted);
	expect(body.get("attendee.2.name")).toBe("Lucy Lovelace");
	expect(body.get("attendee.2.minor")).toBe("on");
	await context.close();
});

test("T157 a refused form shows every row it kept", async ({ page }) => {
	await page.goto(WAIVER);
	const widget = page.getByTestId("booking-with-waiver");
	await widget.locator("button[data-day]").first().click();
	await widget.locator("[data-times]:visible").getByRole("radio").first().click();
	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Your email").fill("ada@example.com");
	await widget.getByLabel("Attendee 1 Name").fill("Ada Lovelace");
	await widget.getByRole("button", { name: "Add another person" }).click();
	await widget.getByRole("button", { name: "Add another person" }).click();
	await widget.getByLabel("Attendee 3 Name").fill("Charles Babbage");
	await page.route("**/_events/waiver", (route) =>
		route.fulfill({
			status: 303,
			headers: {
				location: `${WAIVER}?waiver_error=WAIVER_EMAIL_REQUIRED&waiver_fields=attendee.3.email&waiver_event=e2e-waiver-picker`,
			},
		}),
	);
	await widget.getByRole("button", { name: "Book", exact: true }).click();
	await expect(widget.getByTestId("waiver-alert")).toBeVisible();
	await expect(widget.getByLabel("Attendee 3 Name")).toHaveValue("Charles Babbage");
	await expect(widget.getByLabel("Attendee 3 Name")).toBeVisible();
	await expect(widget.getByLabel("Attendee 2 Name")).toBeVisible();
	await expect(widget.getByLabel("Attendee 4 Name")).toBeHidden();
	await expect(widget.getByTestId("waiver-summary")).toContainText("2 people");
});

test("T157 the confirmed page leads with the session, place and reference; cancel is quiet and confirmed", async ({ browser }) => {
	for (const [label, viewport] of [["desktop", DESKTOP], ["375", MOBILE]] as const) {
		const { context, page } = await open(browser, VIEW, viewport);
		const details = page.getByTestId("booking-details");
		await expect(details.locator("h2")).toHaveText("Clay shooting session (30 shots)");
		await expect(details.getByTestId("booking-when")).toHaveText(/14 March 2030 at 13:30$/);
		await expect(details.getByTestId("booking-venue")).toHaveText("Lea Marston Shooting Ground");
		await expect(details.getByTestId("booking-ref")).toHaveText("PV52PKY5AK");
		await expect(details.getByTestId("booking-attendees")).toContainText("Byron Lovelace");
		// "Cancel booking" is at the foot, and only opens its confirmation.
		const cancel = page.getByTestId("booking-cancel");
		expect((await cancel.boundingBox())?.y ?? 0).toBeGreaterThan((await page.getByTestId("ticket-pass").last().boundingBox())?.y ?? 0);
		await expect(page.getByRole("button", { name: "Yes, cancel this booking" })).toBeHidden();
		expect(await noSideways(page)).toBeLessThanOrEqual(0);
		await shot(page, `confirmed-${label}`);
		await cancel.getByText("Cancel booking").click();
		await expect(page.getByRole("button", { name: "Yes, cancel this booking" })).toBeVisible();
		await context.close();
	}
});

test("T157 Print or save as PDF prints a record without buttons or the brand bar", async ({ browser }) => {
	const { context, page } = await open(browser, VIEW);
	await page.evaluate(() => {
		(window as unknown as { printed: number }).printed = 0;
		window.print = () => {
			(window as unknown as { printed: number }).printed++;
		};
	});
	await page.getByRole("button", { name: "Print or save as PDF" }).click();
	expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

	await page.emulateMedia({ media: "print" });
	await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
	await expect(page.locator(".semics-page-brand")).toBeHidden();
	await expect(page.getByTestId("booking-cancel")).toBeHidden();
	await expect(page.getByTestId("add-to-calendar")).toBeHidden();
	for (const id of ["booking-ref", "booking-when", "booking-attendees"]) await expect(page.getByTestId(id)).toBeVisible();
	await expect(page.getByTestId("booking-details")).toContainText("£90.00");
	await expect(page.getByTestId("ticket-qr")).toHaveCount(2);
	await expect(page.getByTestId("ticket-qr").first()).toBeVisible();
	await expect(page.getByTestId("page-organiser")).toContainText("Organised by Lea Marston Shooting Club");
	await expect(page.getByTestId("page-organiser")).toContainText("Sutton Coldfield B76 0DE");
	await shot(page, "confirmed-print");
	await context.close();

	// Without JavaScript the button would do nothing, so it stays hidden.
	const noJs = await open(browser, VIEW, DESKTOP, false);
	await expect(noJs.page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
	await noJs.context.close();
});

test("T157 the real booking page after a Free booking: session first, print button, quiet cancel", async ({ browser }) => {
	const context = await browser.newContext({ viewport: DESKTOP, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.157" } });
	const page = await context.newPage();
	await page.goto("/e2e/waiver?slug=london-meetup");
	const widget = page.getByTestId("booking-with-waiver");
	await page.getByLabel("Your name").fill("Ada Lovelace");
	await page.getByLabel("Your email").fill("ada@example.com");
	await widget.getByLabel("How many").fill("2");
	await expect(widget.getByTestId("waiver-summary")).toContainText("2 people");
	await widget.getByRole("button", { name: "Book", exact: true }).click();
	await expect(page).toHaveURL(/\/booking\?ref=[0-9A-Z]{10}$/);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("booking-details").locator("h2")).toHaveText("London Community Meetup");
	await expect(page.getByTestId("booking-when")).toBeVisible();
	await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
	await expect(page.getByTestId("booking-cancel")).toBeVisible();
	await shot(page, "real-confirmed-desktop");
	await page.setViewportSize(MOBILE);
	await page.reload();
	expect(await noSideways(page)).toBeLessThanOrEqual(0);
	await shot(page, "real-confirmed-375");
	const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
	expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
	await context.close();
});
