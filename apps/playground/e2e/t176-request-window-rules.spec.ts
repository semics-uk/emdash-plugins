import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";

import { createEvent, EVENTS } from "./harness/pro";

// T176: booking-request windows that change by weekday and season. An LMSC-shaped event: Morning and Afternoon
// every open day, but from April until the clocks go back Wednesdays offer only the late windows. The widget shows
// only the chosen date's windows, and the server refuses a normal window on a summer Wednesday. Free build.

test.describe.configure({ mode: "serial" });

const SLUG = `t176-lmsc-${Date.now().toString(36)}`;
let eventId = "";

test.beforeAll(async ({ request }) => {
	eventId = await createEvent(request, {
		slug: SLUG,
		title: "LMSC Request Windows",
		startsAt: "2031-01-01T09:00:00.000Z",
		config: {
			status: "on_sale",
			capacity: 20,
			currency: "GBP",
			signature: { required: false },
			requests: {
				windows: [
					{ id: "morning", label: "Morning", start: "10:00", end: "12:00" },
					{ id: "afternoon", label: "Afternoon", start: "12:00", end: "15:30" },
				],
				days: ["WE", "SA", "SU"],
				aheadDays: 365,
				noticeDays: 0,
				closedDates: [],
				rules: [
					{
						days: ["WE"],
						from: "04-01",
						to: "10-31",
						summer: true,
						windows: [
							{ id: "late-1", label: "Late 1", start: "15:30", end: "17:00" },
							{ id: "late-2", label: "Late 2", start: "17:00", end: "18:30" },
						],
					},
				],
			},
		},
		ticketTypes: [{ name: "Ski place", priceMinor: 0, capacity: 20, maxPerOrder: 5 }],
	});
});

/** Wednesdays in the select: one well inside British Summer Time (May to September), one in winter (Dec to Feb). */
const wednesdays = (values: string[]) => {
	const wed = values.filter((v) => new Date(`${v}T12:00:00Z`).getUTCDay() === 3);
	const month = (v: string) => Number(v.slice(5, 7));
	return {
		summer: wed.find((v) => month(v) >= 5 && month(v) <= 9) as string,
		winter: wed.find((v) => month(v) === 12 || month(v) <= 2) as string,
	};
};

test("T176 a summer Wednesday offers only the late windows, a winter Wednesday the normal ones", async ({ browser }) => {
	const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${randomInt(1, 250)}` } });
	const page = await context.newPage();
	await page.goto(`/events/${SLUG}`);
	const widget = page.getByTestId("booking-widget");
	const date = widget.getByLabel("Date", { exact: true });
	await expect(date).toBeVisible();
	const values = await date
		.locator("option:not([value=''])")
		.evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
	const { summer, winter } = wednesdays(values);
	expect(summer).toBeTruthy();
	expect(winter).toBeTruthy();
	const windows = widget.getByTestId("booking-windows");
	const radio = (name: string) => windows.getByRole("radio", { name: new RegExp(name) });

	await date.selectOption(summer);
	await expect(radio("Late 1")).toBeVisible();
	await expect(radio("Late 2")).toBeVisible();
	await expect(radio("Morning")).toBeHidden();
	await expect(radio("Afternoon")).toBeHidden();

	await date.selectOption(winter);
	await expect(radio("Morning")).toBeVisible();
	await expect(radio("Afternoon")).toBeVisible();
	await expect(radio("Late 1")).toBeHidden();
	await expect(radio("Late 2")).toBeHidden();
	await context.close();
});

test("T176 the server refuses a normal window on a summer Wednesday", async ({ request }) => {
	const event = await request.get(`${EVENTS}/public/event?eventId=${encodeURIComponent(eventId)}`);
	expect(event.ok(), await event.text()).toBe(true);
	const ticketTypeId = ((await event.json()) as { data: { ticketTypes: Array<{ id: string }> } }).data.ticketTypes[0]
		?.id as string;
	// The next Wednesday in May: inside British Summer Time and within the 365 days ahead.
	const d = new Date(Date.now() + 2 * 864e5);
	while (!(d.getUTCDay() === 3 && d.getUTCMonth() === 4)) d.setUTCDate(d.getUTCDate() + 1);
	const summer = d.toISOString().slice(0, 10);
	const reserve = async (window: string) => {
		const res = await request.post(`${EVENTS}/public/checkout/reserve`, {
			headers: { "x-emdash-request": "1", "x-forwarded-for": `198.51.100.${randomInt(1, 250)}` },
			data: {
				eventId,
				lines: [{ ticketTypeId, qty: 1 }],
				buyer: { name: "Ada Lovelace", email: "ada@example.com" },
				idempotencyKey: `t176-${window}-${Date.now()}-${"k".repeat(16)}`,
				request: { date: summer, window },
			},
		});
		return JSON.stringify(await res.json());
	};
	const refused = await reserve("morning");
	expect(refused).toContain("REQUEST_WINDOW");
	const taken = await reserve("late-1");
	expect(taken).toContain('"bookingRef"');
	expect(taken).not.toContain("REQUEST_WINDOW");
});
