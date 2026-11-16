import { expect, test } from "@playwright/test";

import {
	address,
	admin,
	BOOKING_URL,
	bookingByRef,
	createEvent,
	EVENTS,
	mailbox,
	mailTo,
	pairEsign,
	requirePro,
	runCron,
} from "./harness/pro";

// T174a: an event that takes booking requests (a preferred date and a time window, no fixed date).
// The buyer asks through the event page's widget, the booking waits for the organiser with the time
// to be agreed, the admin's "Confirm time" confirms it with a time, and the booking page then shows it.
// Runs on the Free build (and on Pro: nothing here is edition-specific). T174c (Events Pro only): the admin proposes
// another time instead, the buyer gets an email and accepts it, or says it doesn't work, on the booking page.
// T174e (Events Pro only): a waiver request is booked without names (the suite's <BookingWithWaiver> shows no attendee
// rows); nothing is listed or sent while it waits; once confirmed the buyer names a seat and that person is invited.

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

/** Requests the first offered date's AM window for one place through the widget; the page, its ref and the stored id. */
async function requestOne(browser: import("@playwright/test").Browser, who: string) {
	const context = await browser.newContext({
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	const page = await context.newPage();
	const email = address(who);
	await page.goto(`/events/${SLUG}`);
	const widget = page.getByTestId("booking-widget");
	const date = widget.getByLabel("Date", { exact: true });
	const day = (await date.locator("option:not([value=''])").first().getAttribute("value")) as string;
	await date.selectOption(day);
	await widget.getByRole("radio", { name: /AM/ }).check();
	await widget.getByLabel(/Trek place/).fill("1");
	await widget.getByLabel("Your name").fill("Grace Hopper");
	await widget.getByLabel("Email").fill(email);
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(BOOKING_URL);
	const ref = BOOKING_URL.exec(page.url())?.[1] as string;
	return { context, page, email, ref, id: bookingByRef(ref).id, day };
}

const proposeTime = async (request: import("@playwright/test").APIRequestContext, id: string) => {
	const res = await request.post(`${EVENTS}/admin`, {
		headers: admin,
		data: {
			type: "form_submit",
			action_id: `bookings.propose:${id}`,
			block_id: "p:Europe/London",
			values: { date: "2030-12-14", start: "14:00", end: "15:30" },
		},
	});
	expect(res.ok()).toBe(true);
	expect(JSON.stringify(await res.json())).toContain("time proposed");
};

test("T174c the admin proposes another time, the buyer accepts it on the booking page", async ({ browser, request }) => {
	await requirePro(request);
	const r = await requestOne(browser, "propose-accept");
	await proposeTime(request, r.id);
	const mail = await mailTo(request, r.email, /another time/i);
	expect(mail.text).toContain("Sat 14 Dec 2030, 14:00");

	await r.page.reload();
	const proposal = r.page.getByTestId("booking-proposal");
	await expect(proposal).toBeVisible();
	await expect(r.page.getByTestId("booking-proposed")).toContainText("14:00");
	await proposal.getByRole("button", { name: "Accept this time" }).click();
	await expect(r.page.getByTestId("booking-notice")).toContainText("confirmed for the new time");
	await expect(r.page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await expect(r.page.getByTestId("booking-when")).toContainText("14:00");
	await expect(r.page.getByTestId("booking-proposal")).toHaveCount(0);
	expect(bookingByRef(r.ref).data.time).toMatchObject({ startsAt: "2030-12-14T14:00:00.000Z" });
	await r.context.close();
});

test("T174c the buyer says the proposed time doesn't work: the request is cancelled", async ({ browser, request }) => {
	await requirePro(request);
	const r = await requestOne(browser, "propose-refuse");
	await proposeTime(request, r.id);
	await r.page.reload();
	await r.page.getByTestId("booking-proposal").getByRole("button", { name: "That doesn't work" }).click();
	await expect(r.page.getByTestId("booking-notice")).toContainText("Your request was cancelled");
	await expect(r.page.getByTestId("booking-status")).toHaveAttribute("data-status", "cancelled");
	await r.context.close();
});

test("T174e a waiver request is booked without names; once confirmed a named seat is invited", async ({
	browser,
	request,
	baseURL,
}) => {
	await requirePro(request);
	const templateId = await pairEsign(request, baseURL as string);
	const slug = `t174e-quad-waiver-${Date.now().toString(36)}`;
	await createEvent(request, {
		slug,
		title: "Quad Trek Waiver Request",
		startsAt: "2031-01-01T09:00:00.000Z",
		config: {
			status: "on_sale",
			capacity: 20,
			currency: "GBP",
			signature: { required: true, templateId, mode: "each_attendee" },
			requests: {
				windows: [{ id: "am", label: "AM", start: "10:00", end: "12:00" }],
				days: ["SA", "SU"],
				aheadDays: 60,
				noticeDays: 2,
				closedDates: [],
			},
		},
		ticketTypes: [{ name: "Trek place", priceMinor: 0, capacity: 20, maxPerOrder: 5 }],
	});
	const context = await browser.newContext({
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	const page = await context.newPage();
	const buyer = address("t174e-buyer");
	const adult = address("t174e-adult");
	await page.goto(`/e2e/waiver?slug=${slug}`);
	const widget = page.getByTestId("booking-with-waiver");
	// No attendee rows: a ticket count, and a note that the names come after the time is confirmed.
	await expect(widget.getByTestId("waiver-attendee")).toHaveCount(0);
	await expect(widget.getByTestId("waiver-later")).toBeVisible();
	const date = widget.getByLabel("Date", { exact: true });
	const day = (await date.locator("option:not([value=''])").first().getAttribute("value")) as string;
	await date.selectOption(day);
	await widget.getByRole("radio", { name: /AM/ }).check();
	await widget.getByLabel("How many").fill("2");
	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Your email").fill(buyer);
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(BOOKING_URL);
	const ref = BOOKING_URL.exec(page.url())?.[1] as string;
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "awaiting_approval");
	// Nothing to sign or name while the request waits.
	await expect(page.getByTestId("attendee-list")).toHaveCount(0);
	const stored = bookingByRef(ref);
	expect(stored.data.waiver).toMatchObject({ after: true });

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

	await page.reload();
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	const list = page.getByTestId("attendee-list");
	await expect(list.getByTestId("attendee-row")).toHaveCount(2);
	await expect(list.getByTestId("attendee-unnamed")).toHaveCount(1);
	const edit = page.getByTestId("attendee-edit");
	await edit.getByLabel("Name").nth(1).fill("Charles Babbage");
	await edit.getByLabel("Email").nth(1).fill(adult);
	await edit.getByTestId("attendee-save").click();
	await expect(page).toHaveURL(new RegExp(`/booking\\?ref=${ref}&attendees=saved`));
	await expect(list.getByTestId("attendee-unnamed")).toHaveCount(0);
	let invited = 0;
	for (let tick = 0; tick < 20 && invited === 0; tick++) {
		invited = (await mailbox(request, adult)).filter((m) => /asks you to sign/.test(m.subject)).length;
		if (invited === 0) await runCron(request, "outbox-drain", "semics-esign");
	}
	expect(invited).toBe(1);
	await context.close();
});
