import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { BOOKING_URL, bookingByRef, createEvent, isPro, requirePro, runCron } from "./harness/pro";

// T135 (R94, R96) end to end on the playground built with Events Pro: an event with a slot schedule
// (two sessions a day, two places each) gets its slots from the real `occurrences` cron job, and the
// event page's day-then-time picker books one; the slot then shows one place left, and a second
// booking (without JavaScript, through the grouped select) fills it. `/e2e/picker` (T130) covers the
// picker's keyboard and paging with fixed data; this is the same picker on a real schedule.

test.describe.configure({ mode: "serial" });

const SLUG = "t135-range-lanes";
let eventId = "";

test.beforeAll(async ({ request }) => {
	const tomorrow = new Date(Date.now() + 86_400_000);
	tomorrow.setUTCHours(9, 0, 0, 0);
	if (!(await isPro(request))) return;
	eventId = await createEvent(request, {
		slug: SLUG,
		title: "Archery Range Lanes",
		startsAt: tomorrow.toISOString(),
		timezone: "UTC",
		config: {
			status: "on_sale",
			capacity: 500,
			currency: "GBP",
			signature: { required: false },
			schedule: {
				days: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
				times: ["10:00", "14:00"],
				durationMinutes: 60,
				capacity: 2,
				bookAheadDays: 14,
			},
		},
		ticketTypes: [{ name: "Lane", priceMinor: 0, capacity: 500, maxPerOrder: 2 }],
	});
	// The recurring job plans the slots (one event a tick).
	await runCron(request, "occurrences");
});

async function violations(page: Page) {
	const results = await new AxeBuilder({ page }).include(".semics-events").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
	return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const visitor = () => ({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` });

test("R96 with JS: pick a day, then a time, book it; the slot then has one place left", async ({ browser, request }) => {
	await requirePro(request);
	const context = await browser.newContext({ extraHTTPHeaders: visitor(), viewport: { width: 320, height: 800 } });
	const page = await context.newPage();
	await page.goto(`/events/${SLUG}`);
	const widget = page.getByTestId("booking-widget");
	const picker = widget.getByTestId("booking-picker");
	await expect(picker).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
	expect(await violations(page)).toEqual([]);

	const day = picker.locator("button[data-day]").first();
	await day.click();
	const times = picker.locator("[data-times]:visible").getByRole("radio");
	await expect(times).toHaveCount(2);
	await times.first().click();
	const slot = (await times.first().getAttribute("data-occurrence")) as string;
	expect(slot).toMatch(new RegExp(`^s-${eventId}-`));
	await widget.getByLabel(/Lane/).fill("1");
	await widget.getByLabel("Your name").fill("Howard Hill");
	await widget.getByLabel("Email").fill("howard@example.com");
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(BOOKING_URL);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	const ref = BOOKING_URL.exec(page.url())?.[1] as string;
	expect(bookingByRef(ref).data.occurrenceId).toBe(slot);

	await page.goto(`/events/${SLUG}`);
	await picker.locator("button[data-day]").first().click();
	await expect(picker.locator(`[role="radio"][data-occurrence="${slot}"]`)).toContainText("1 place left");
	await context.close();
});

test("R96 no JS: the grouped select books the same slot's last place; it is then full", async ({ browser, request }) => {
	await requirePro(request);
	const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: visitor() });
	const page = await context.newPage();
	await page.goto(`/events/${SLUG}`);
	const widget = page.getByTestId("booking-widget");
	const select = widget.getByLabel("Date", { exact: true });
	const first = select.locator("optgroup").first().locator("option").first();
	await expect(first).toHaveText(/1 place left/);
	const slot = (await first.getAttribute("value")) as string;
	await select.selectOption(slot);
	await widget.getByLabel(/Lane/).fill("1");
	await widget.getByLabel("Your name").fill("Lars Andersen");
	await widget.getByLabel("Email").fill("lars@example.com");
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(BOOKING_URL);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");

	await page.goto(`/events/${SLUG}`);
	await expect(select.locator(`option[value="${slot}"]`)).toBeDisabled();
	await context.close();
});
