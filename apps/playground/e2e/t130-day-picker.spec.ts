import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// T130 (EV-FR-17): the booking widget's day-then-time picker on `/e2e/picker` (a slot schedule's data:
// three sessions a day on next month's first nine days, so they never straddle a month end (T134); day 2's
// 13:00 full, day 3 fully booked). Without JavaScript the dates are a select grouped by day; with it, a
// month calendar of days, then the day's times. `/e2e/pickers` has two pickers that page independently (T134).

const PAGE = "/e2e/picker";

async function violations(page: import("@playwright/test").Page) {
	const results = await new AxeBuilder({ page }).include(".semics-events").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
	return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("EV-FR-17 no JS: a select of the month's dates grouped by day, full times disabled", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto(PAGE);
	const widget = page.getByTestId("booking-widget");
	await expect(widget.getByTestId("booking-picker")).toBeHidden();
	const select = widget.getByLabel("Date", { exact: true });
	await expect(select).toBeVisible();
	const groups = select.locator("optgroup");
	// All nine days are on the one month the page opens on, whatever today's date (T134).
	await expect(groups).toHaveCount(9);
	await expect(groups.first()).toHaveAttribute("label", /\d{4}/);
	// Day 2's 13:00 and all of day 3 are full.
	const full = select.locator('option[value="s-e2e-1-1"], option[value^="s-e2e-2-"]');
	await expect(full).toHaveCount(4);
	for (const option of await full.all()) await expect(option).toBeDisabled();
	await expect(select.locator("option:not([disabled])").nth(1)).toHaveText(/^\d\d:\d\d, \d places? left$/);
	// The month's paging links work without JS (axe needs scripts: the JS tests run it).
	await context.close();
});

test("EV-FR-17 with JS: pick a day, then a time; full ones are disabled; keyboard roves", async ({ page }) => {
	await page.goto(PAGE);
	const widget = page.getByTestId("booking-widget");
	const picker = widget.getByTestId("booking-picker");
	await expect(picker).toBeVisible();
	await expect(widget.locator("[data-picker-fallback]")).toBeHidden();
	const select = widget.locator('select[name="occurrenceId"]');

	// Submitting without a time puts the error on the picker and focus on its day.
	await widget.getByLabel(/Lane/).fill("1");
	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Email").fill("ada@example.com");
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(picker).toHaveAttribute("aria-invalid", "true");
	await expect(widget.locator("[data-error-for=occurrence]")).toHaveText("Choose a date.");
	const days = picker.locator("button[data-day]");
	await expect(days.first()).toBeFocused();

	// The first day's times: a radio group; choosing one sets the form's select.
	await days.first().click();
	await expect(days.first()).toHaveAttribute("aria-pressed", "true");
	const group = picker.locator("[data-times]:visible");
	await expect(group).toHaveCount(1);
	const times = group.getByRole("radio");
	await expect(times).toHaveCount(3);
	await times.first().click();
	await expect(times.first()).toHaveAttribute("aria-checked", "true");
	expect(await select.inputValue()).toBe(await times.first().getAttribute("data-occurrence"));

	// Arrow keys move between times and choose them.
	await times.first().press("ArrowRight");
	await expect(times.nth(1)).toBeFocused();
	expect(await select.inputValue()).toBe(await times.nth(1).getAttribute("data-occurrence"));

	// Arrow keys move focus between days; another day clears the time.
	await days.first().focus();
	await days.first().press("ArrowRight");
	await expect(days.nth(1)).toBeFocused();
	await days.nth(1).press("Enter");
	expect(await select.inputValue()).toBe("");

	// A full time cannot be chosen.
	const full = picker.locator('[role="radio"][aria-disabled="true"]').first();
	if ((await full.count()) > 0) {
		const day = await full.locator("xpath=..").getAttribute("data-times");
		await picker.locator(`button[data-day="${day}"]`).click();
		await full.click({ force: true });
		await expect(full).toHaveAttribute("aria-checked", "false");
	}
	expect(await violations(page)).toEqual([]);
});

test("EV-FR-17 fits a 320 px screen without sideways scroll", async ({ browser }) => {
	const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
	const page = await context.newPage();
	await page.goto(PAGE);
	await expect(page.getByTestId("booking-picker")).toBeVisible();
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	expect(await violations(page)).toEqual([]);
	await context.close();
});

/** The month each picker on `/e2e/pickers` shows: [pottery, climbing]. */
async function months(page: import("@playwright/test").Page) {
	return Promise.all(
		["Book pottery", "Book climbing"].map(async (name) => {
			const widget = page.getByTestId("booking-widget").filter({ has: page.getByRole("heading", { name }) });
			return (await widget.locator(".semics-picker-month").textContent())?.trim() ?? "";
		}),
	);
}

for (const javaScriptEnabled of [false, true]) {
	test(`T134 EV-FR-17 two pickers on one page page independently (${javaScriptEnabled ? "with" : "no"} JS)`, async ({
		browser,
	}) => {
		const context = await browser.newContext({ javaScriptEnabled });
		const page = await context.newPage();
		await page.goto("/e2e/pickers");
		const widget = (name: string) =>
			page.getByTestId("booking-widget").filter({ has: page.getByRole("heading", { name }) });
		const pottery = widget("Book pottery");
		const climbing = widget("Book climbing");
		if (javaScriptEnabled) {
			await expect(pottery.getByTestId("booking-picker")).toBeVisible();
			await expect(climbing.getByTestId("booking-picker")).toBeVisible();
		}
		const [next, same] = await months(page);
		expect(same).toBe(next);

		// Paging one widget leaves the other on its month.
		await pottery.getByRole("link", { name: "Later dates" }).click();
		await expect(page).toHaveURL(/[?&]booking_from\.e2e-picker-a=\d{4}-\d{2}-01#semics-booking-e2e-picker-a$/);
		const [later, kept] = await months(page);
		expect(later).not.toBe(next);
		expect(kept).toBe(next);
		await climbing.getByRole("link", { name: "Later dates" }).click();
		await expect(page).toHaveURL(/booking_from\.e2e-picker-a=.+&booking_from\.e2e-picker-b=/);
		await expect.poll(() => months(page)).toEqual([later, later]);
		await pottery.getByRole("link", { name: "Earlier dates" }).click();
		await expect.poll(() => months(page)).toEqual([next, later]);
		if (javaScriptEnabled) await expect(climbing.getByTestId("booking-picker")).toBeVisible();
		await context.close();
	});
}
