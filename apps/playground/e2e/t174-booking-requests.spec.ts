import { expect, test } from "@playwright/test";

import { address, admin, BOOKING_URL, bookingByRef, createEvent, EVENTS, mailTo } from "./harness/pro";

// T174a: an event that takes booking requests (a preferred date and a time window, no fixed date).
// The buyer asks through the event page's widget, the booking waits for the organiser with the time
// to be agreed, the admin's "Confirm time" confirms it with a time, and the booking page then shows it.
// Runs on the Free build (and on Pro: nothing here is edition-specific).

test.describe.configure({ mode: "serial" });

const SLUG = `t174-quad-trek-${Date.now().toString(36)}`;

test.beforeAll(async ({ request }) => {
	await createEvent(request, {
		slug: SLUG,
		title: "Quad Trek Request",
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
				closedDates: [],
			},
		},
		ticketTypes: [{ name: "Trek place", priceMinor: 0, capacity: 20, maxPerOrder: 5 }],
	});
});

test("T174a request a date and window, the admin confirms a time, the booking page shows it", async ({ browser, request }) => {
	const context = await browser.newContext({
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	const page = await context.newPage();
	const email = address("request");
	await page.goto(`/events/${SLUG}`);
	const widget = page.getByTestId("booking-widget");
	const date = widget.getByLabel("Date", { exact: true });
	await expect(date).toBeVisible();
	// Only weekend days are offered.
	const values = await date.locator("option:not([value=''])").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
	expect(values.length).toBeGreaterThan(10);
	for (const v of values) expect([0, 6]).toContain(new Date(`${v}T12:00:00Z`).getUTCDay());
	const day = values[0] as string;
	await date.selectOption(day);
	await widget.getByRole("radio", { name: /AM/ }).check();
	await widget.getByLabel(/Trek place/).fill("2");
	await widget.getByLabel("Your name").fill("Grace Hopper");
	await widget.getByLabel("Email").fill(email);
	await widget.getByRole("button", { name: "Book" }).click();

	await expect(page).toHaveURL(BOOKING_URL);
	const ref = BOOKING_URL.exec(page.url())?.[1] as string;
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "awaiting_approval");
	await expect(page.getByTestId("booking-request")).toContainText("we'll confirm a time with you");
	await expect(page.getByTestId("booking-when")).toHaveCount(0);

	const stored = bookingByRef(ref);
	expect(stored.data.request).toEqual({ date: day, window: "am" });
	const mail = await mailTo(request, email, /request/i);
	expect(mail.text).toContain("time to be agreed");

	const res = await request.post(`${EVENTS}/admin`, {
		headers: admin,
		data: {
			type: "form_submit",
			action_id: `bookings.confirm:${stored.id}`,
			block_id: "Europe/London",
			values: { date: day, start: "10:30", end: "12:00" },
		},
	});
	expect(res.ok()).toBe(true);
	expect(JSON.stringify(await res.json())).toContain(`${ref}: confirmed`);
	expect(bookingByRef(ref).data.time).toBeTruthy();

	await page.reload();
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("booking-when")).toContainText("10:30");
	await context.close();
});
