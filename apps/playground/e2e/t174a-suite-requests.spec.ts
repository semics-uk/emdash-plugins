import { randomInt } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { address, BOOKING_URL, bookingByRef, createEvent } from "./harness/pro";

// T174a in the suite (LMSC staging rc.18): LMSC renders <BookingWithWaiver event={id} />, which showed a request
// event's plain ticket form. Now it has Events' request mode: a select of the allowed dates (weekdays, notice,
// days ahead, closed dates) and window radios; the post carries `request`, and the booking waits for approval
// with the time to be agreed. The playground page `/e2e/waiver` renders <BookingWithWaiver> for a slug.

test.describe.configure({ mode: "serial" });

const SLUG = `t174a-suite-trek-${Date.now().toString(36)}`;
const PAGE = `/e2e/waiver?slug=${SLUG}`;
const visitor = () => ({ "x-forwarded-for": `198.51.100.${randomInt(1, 250)}` });
// The first Saturday 30 days from now, closed: the select must not offer it.
const closed = (() => {
	const d = new Date(Date.now() + 30 * 864e5);
	d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
	return d.toISOString().slice(0, 10);
})();

test.beforeAll(async ({ request }) => {
	await createEvent(request, {
		slug: SLUG,
		title: "Suite Quad Trek Request",
		startsAt: "2031-01-01T09:00:00.000Z",
		config: {
			status: "on_sale",
			capacity: 20,
			currency: "GBP",
			signature: { required: false },
			requests: {
				windows: [
					{ id: "am", label: "AM", start: "10:00", end: "12:00" },
					{ id: "pm", label: "PM", start: "12:00", end: "15:30" },
				],
				days: ["SA", "SU"],
				aheadDays: 60,
				noticeDays: 2,
				closedDates: [closed],
			},
		},
		ticketTypes: [{ name: "Trek place", priceMinor: 0, capacity: 20, maxPerOrder: 5 }],
	});
});

async function sendRequest(context: BrowserContext): Promise<{ page: Page; day: string; email: string }> {
	const page = await context.newPage();
	const email = address("suite-request");
	await page.goto(PAGE);
	const widget = page.getByTestId("booking-with-waiver");
	const date = widget.getByLabel("Date", { exact: true });
	await expect(date).toBeVisible();
	// Only weekend days from two days' notice to 60 days ahead, without the closed Saturday.
	const values = await date
		.locator("option:not([value=''])")
		.evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
	expect(values.length).toBeGreaterThan(10);
	for (const v of values) expect([0, 6]).toContain(new Date(`${v}T12:00:00Z`).getUTCDay());
	expect(values).not.toContain(closed);
	const soonest = Date.parse(values[0] as string);
	expect(soonest).toBeGreaterThanOrEqual(Date.parse(new Date().toISOString().slice(0, 10)) + 864e5);
	await expect(widget.getByTestId("booking-windows").getByRole("radio")).toHaveCount(2);

	const day = values[0] as string;
	await date.selectOption(day);
	await widget.getByRole("radio", { name: /PM/ }).check();
	await widget.getByLabel("How many").fill("2");
	await page.getByLabel("Your name").fill("Grace Hopper");
	await page.getByLabel("Your email").fill(email);
	await widget.getByRole("button", { name: "Book" }).click();
	return { page, day, email };
}

for (const javaScriptEnabled of [true, false]) {
	test(`T174a <BookingWithWaiver> sends a request that waits for approval (${javaScriptEnabled ? "JS" : "no JS"})`, async ({
		browser,
	}) => {
		const context = await browser.newContext({ javaScriptEnabled, extraHTTPHeaders: visitor() });
		const { page, day } = await sendRequest(context);

		await expect(page).toHaveURL(BOOKING_URL);
		const ref = BOOKING_URL.exec(page.url())?.[1] as string;
		await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "awaiting_approval");
		await expect(page.getByTestId("booking-request")).toContainText("Request sent: we'll confirm a time with you.");
		await expect(page.getByTestId("booking-when")).toHaveCount(0);

		const stored = bookingByRef(ref);
		expect(stored.data.status).toBe("awaiting_approval");
		expect(stored.data.request).toEqual({ date: day, window: "pm" });
		expect(stored.data).not.toHaveProperty("occurrenceId");
		await context.close();
	});
}
