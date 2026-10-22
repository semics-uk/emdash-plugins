import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

import { runCheckoutLoad } from "../load/checkout.mjs";

// T056 (Phase 2 exit): the free booking journey end to end, and the concurrency proof.
//
// Emails: the site's email provider in this build is src/e2e/mail-capture.mjs, so a test reads the
// message the core rendered and sent at drain time (`/e2e/mail`), not the outbox row, which holds
// ids only: the booking link's one-time code is minted when the email is sent (R34).
// Cron: `/e2e/cron?task=outbox-drain` makes the drain due and runs one batch, instead of waiting
// for the one-minute timer. A drain sends two emails per tick, so `mailTo` ticks until it arrives.
// Each visitor gets its own IP (X-Forwarded-For, trusted in playwright.config.ts).

const DB = resolve(import.meta.dirname, "../data.db");
const BOOKING_URL = /\/booking\?ref=([0-9A-Z]{10})$/;

interface Mail {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

let ipSeq = 0;
async function visitor(browser: Browser, javaScriptEnabled = false) {
	ipSeq += 1;
	const context = await browser.newContext({
		javaScriptEnabled,
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${ipSeq}` },
	});
	return { context, page: await context.newPage() };
}

async function mailTo(request: APIRequestContext, to: string, subject: RegExp): Promise<Mail> {
	for (let tick = 0; tick < 30; tick++) {
		const { messages } = (await (await request.get(`/e2e/mail?to=${encodeURIComponent(to)}`)).json()) as {
			messages: Mail[];
		};
		const found = messages.find((m) => subject.test(m.subject));
		if (found) return found;
		const ran = await request.post("/e2e/cron?task=outbox-drain");
		expect(ran.ok()).toBe(true);
	}
	throw new Error(`no email "${subject}" to ${to}`);
}

/** The emailed booking link as a same-site path (the email carries the site's absolute URL). */
function bookingLink(mail: Mail): { path: string; ref: string; code: string } {
	const match = mail.text.match(/View or cancel your booking: (\S+)/);
	if (!match?.[1]) throw new Error("no booking link in the email");
	const url = new URL(match[1], "http://site.invalid");
	return { path: `${url.pathname}${url.search}`, ref: url.searchParams.get("ref") ?? "", code: url.searchParams.get("k") ?? "" };
}

async function book(page: Page, slug: string, ticket: RegExp, name: string, email: string): Promise<string> {
	await page.goto(`/events/${slug}`);
	const widget = page.getByTestId("booking-widget");
	await page.getByLabel(ticket).fill("1");
	await page.getByLabel("Your name").fill(name);
	await page.getByLabel("Email").fill(email);
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(BOOKING_URL);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	return BOOKING_URL.exec(page.url())?.[1] ?? "";
}

/** Opens the emailed link in a browser that has never seen the booking, and redeems it. */
async function openFromEmail(browser: Browser, link: { path: string; ref: string }) {
	const v = await visitor(browser);
	await v.page.goto(link.path);
	await v.page.getByRole("button", { name: "Open my booking" }).click();
	await expect(v.page).toHaveURL(new RegExp(`/booking\\?ref=${link.ref}$`));
	await expect(v.page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	return v;
}

async function calendarFile(page: Page, request: APIRequestContext): Promise<string> {
	const href = (await page.getByTestId("add-to-calendar").getAttribute("href")) ?? "";
	expect(href).toMatch(/\/public\/booking\/ics\?.*sig=/);
	expect(href).not.toMatch(/token|[?&]k=/i);
	const res = await request.get(href);
	expect(res.status()).toBe(200);
	expect(res.headers()["content-type"]).toContain("text/calendar");
	return res.text();
}

test("Phase 2 journey: list → book → email (captured) → open from the email → ICS → cancel", async ({
	browser,
	request,
}) => {
	const email = `journey-${Date.now()}@example.com`;
	const buyer = await visitor(browser);

	// List: the card links to the event page by the entry's slug (T054), from public/events.
	await buyer.page.goto("/whats-on");
	const card = buyer.page.getByTestId("event-card").filter({ hasText: "London Community Meetup" });
	await card.getByRole("link", { name: "London Community Meetup" }).click();
	await expect(buyer.page).toHaveURL(/\/events\/london-meetup$/);

	// Book (no JS).
	const ref = await book(buyer.page, "london-meetup", /General admission/, "Ada Lovelace", email);
	await buyer.context.close();

	// Email: rendered and sent by the outbox drain, carrying a one-time code, never the token.
	const confirmation = await mailTo(request, email, /^Your booking: London Community Meetup$/);
	expect(confirmation.text).toContain(`Reference: ${ref}`);
	const link = bookingLink(confirmation);
	expect(link.ref).toBe(ref);
	expect(link.code).toMatch(/^[A-Za-z0-9_-]{20,}$/);

	// A mail scanner's GET (twice) shows the button and redeems nothing.
	for (let i = 0; i < 2; i++) {
		const scan = await request.get(link.path, { maxRedirects: 0 });
		expect(scan.status()).toBe(200);
		expect(scan.headers()["set-cookie"] ?? "").not.toContain("semics_booking_");
		const html = await scan.text();
		expect(html).toContain("Open my booking");
		expect(html).not.toContain('data-testid="booking-status"');
	}

	// Another device opens it: POST redeems, sets the HttpOnly cookie, drops k from the URL.
	const reader = await openFromEmail(browser, link);
	const cookies = await reader.context.cookies();
	const cookie = cookies.find((c) => c.name === `semics_booking_${ref}`);
	expect(cookie?.httpOnly).toBe(true);
	expect(cookie?.path).toBe("/booking");
	expect(reader.page.url()).not.toContain("k=");

	// Pass and calendar come from public/booking (attendee check-in code, signed calendar query; T055).
	await expect(reader.page.getByTestId("ticket-pass")).toHaveCount(1);
	await expect(reader.page.getByTestId("ticket-code")).toHaveText(/^[A-Za-z0-9_-]{20,}$/);
	const ics = await calendarFile(reader.page, request);
	expect(ics).toContain(`booking-${ref}@semics-events`);
	expect(ics).toContain("DTSTART;TZID=Europe/London:20300314T183000");

	// The code is single use: the same link again is refused, and the reader's cookie still works.
	const again = await visitor(browser);
	await again.page.goto(link.path);
	await again.page.getByRole("button", { name: "Open my booking" }).click();
	await expect(again.page.getByTestId("booking-notice")).toHaveAttribute("data-code", "LINK_INVALID");
	await expect(again.page.getByTestId("booking-status")).toHaveCount(0);
	await again.context.close();

	// Cancel from the email's device; the cancellation is emailed too.
	await reader.page.getByRole("button", { name: "Cancel booking" }).click();
	await expect(reader.page.getByTestId("booking-status")).toHaveAttribute("data-status", "cancelled");
	await reader.context.close();
	const cancelled = await mailTo(request, email, /^Booking cancelled: London Community Meetup$/);
	expect(cancelled.text).toContain(ref);
	expect(cancelled.text).not.toMatch(/[?&]k=/);
});

const ZONES = [
	{
		slug: "london-meetup",
		ticket: /General admission/,
		title: "London Community Meetup",
		when: "Thu 14 Mar 2030, 18:30 UTC (Europe/London)",
		dtstart: "DTSTART;TZID=Europe/London:20300314T183000",
		dtend: "DTEND;TZID=Europe/London:20300314T210000",
	},
	{
		slug: "nyc-workshop",
		ticket: /Standby/,
		title: "New York Design Workshop",
		when: "Thu 20 Jun 2030, 10:00 UTC-4 (America/New_York)",
		dtstart: "DTSTART;TZID=America/New_York:20300620T100000",
		dtend: "DTEND;TZID=America/New_York:20300620T140000",
	},
	{
		slug: "sydney-conference",
		ticket: /Conference pass/,
		title: "Sydney Summit",
		when: "Wed 6 Nov 2030, 09:00 UTC+11 (Australia/Sydney)",
		dtstart: "DTSTART;TZID=Australia/Sydney:20301106T090000",
		dtend: "DTEND;TZID=Australia/Sydney:20301106T190000",
	},
];

for (const zone of ZONES) {
	test(`EV-FR-08 email and ICS times are right in ${zone.when.split("(")[1]?.replace(")", "")}`, async ({
		browser,
		request,
	}) => {
		const email = `zone-${zone.slug}-${Date.now()}@example.com`;
		const buyer = await visitor(browser);
		const ref = await book(buyer.page, zone.slug, zone.ticket, "Grace Hopper", email);
		await buyer.context.close();

		const mail = await mailTo(request, email, new RegExp(`^Your booking: ${zone.title}$`));
		expect(mail.text).toContain(`When: ${zone.when}`);

		const reader = await openFromEmail(browser, bookingLink(mail));
		const ics = await calendarFile(reader.page, request);
		expect(ics).toContain(`booking-${ref}@semics-events`);
		expect(ics).toContain(zone.dtstart);
		expect(ics).toContain(zone.dtend);
		expect(ics).toMatch(new RegExp(`BEGIN:VTIMEZONE\\r?\\nTZID:${zone.dtstart.split("=")[1]?.split(":")[0]}`));
		await reader.context.close();
	});
}

test("Phase 2 load: 100 concurrent checkouts for the last 5 seats: exactly 5 book, 95 get SOLD_OUT", async ({
	baseURL,
	request,
}) => {
	test.setTimeout(180_000);
	const result = await runCheckoutLoad({ baseURL, buyers: 100, inFlight: 16 });
	expect(result.maxInFlight).toBe(16); // really concurrent, and never more than 16 at once
	expect(result.booked).toHaveLength(5);
	expect(new Set(result.booked).size).toBe(5);
	expect(result.refused).toEqual({ SOLD_OUT: 95 });

	// The counters agree, nothing oversold or leaked: 5 reserved and sold, 5 confirmed bookings.
	const db = new DatabaseSync(DB, { readOnly: true });
	try {
		const row = db
			.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-events' AND collection = 'ticket_types' AND id = ?")
			.get("tt_london_helper") as { data: string };
		const counters = JSON.parse(row.data) as { reserved: number; sold: number; capacity: number };
		expect([counters.reserved, counters.sold, counters.capacity]).toEqual([5, 5, 5]);
		const confirmed = db
			.prepare(
				`SELECT COUNT(*) AS n FROM _plugin_storage WHERE plugin_id = 'semics-events' AND collection = 'bookings'
				 AND json_extract(data, '$.status') = 'confirmed' AND json_extract(data, '$.lines[0].ticketTypeId') = 'tt_london_helper'`,
			)
			.get() as { n: number };
		expect(confirmed.n).toBe(5);
	} finally {
		db.close();
	}

	// And the public answer says sold out for that type, never negative.
	const event = (await (
		await request.get(`/_emdash/api/plugins/semics-events/public/event?eventId=${encodeURIComponent(result.eventId)}`)
	).json()) as { data: { ticketTypes: Array<{ id: string; available: number }> } };
	expect(event.data.ticketTypes.find((t) => t.id === "tt_london_helper")?.available).toBe(0);
});
