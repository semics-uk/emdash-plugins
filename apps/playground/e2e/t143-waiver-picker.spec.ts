import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// T143: the suite's <BookingWithWaiver> books a slot-schedule event through the same day/time picker as
// Events' booking widget (T130). `/e2e/waiver-picker` has fixed slot data (as `/e2e/picker`). The Free
// playground cannot take the booking itself (slot schedules and waivers are Pro, and the event is
// fixed data), so the post to `/_events/waiver` is answered by the test: what matters here is that the
// form carries the chosen slot to the waiver step (the Pro answers of that step: flow.test.ts, T065).

const PAGE = "/e2e/waiver-picker";

test("T143 with JS: pick a day then a time; the waiver step receives that slot", async ({ page }) => {
	await page.goto(PAGE);
	const widget = page.getByTestId("booking-with-waiver");
	const picker = widget.getByTestId("booking-picker");
	await expect(picker).toBeVisible();
	await expect(widget.locator("[data-picker-fallback]")).toBeHidden();

	await picker.locator("button[data-day]").first().click();
	const times = picker.locator("[data-times]:visible").getByRole("radio");
	await expect(times).toHaveCount(3);
	await times.nth(1).click();
	const slot = (await times.nth(1).getAttribute("data-occurrence")) as string;
	expect(slot).toBe("s-e2e-0-1");

	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Your email").fill("ada@example.com");
	await widget.getByLabel("Attendee 1 Name").fill("Ada Lovelace");

	let posted = "";
	await page.route("**/_events/waiver", async (route) => {
		posted = route.request().postData() ?? "";
		await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Waiver</title><h1>Waiver step</h1>" });
	});
	await widget.getByRole("button", { name: "Book", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Waiver step" })).toBeVisible();
	const body = new URLSearchParams(posted);
	expect(body.get("intent")).toBe("book");
	expect(body.get("occurrenceId")).toBe(slot);
});

test("T143 no JS: the dates are a select grouped by day, full ones disabled", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto(PAGE);
	const widget = page.getByTestId("booking-with-waiver");
	await expect(widget.getByTestId("booking-picker")).toBeHidden();
	const select = widget.getByLabel("Date", { exact: true });
	await expect(select).toBeVisible();
	await expect(select.locator("optgroup")).toHaveCount(9);
	for (const option of await select.locator('option[value^="s-e2e-2-"]').all()) await expect(option).toBeDisabled();
	await context.close();
});

test("T143 fits a 320 px screen and has no accessibility violations", async ({ browser }) => {
	const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
	const page = await context.newPage();
	await page.goto(PAGE);
	await expect(page.getByTestId("booking-picker")).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
	const results = await new AxeBuilder({ page }).include(".semics-events").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
	expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
	await context.close();
});
