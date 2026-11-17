import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

import {
	CHECKOUT_HOST,
	type FakeStripe,
	SECRET_KEY,
	type Session,
	startFakeStripe,
	WEBHOOK_SECRET,
} from "./harness/fake-stripe";
import {
	address,
	admin,
	attendeesOf,
	BOOKING_URL,
	bookingByRef,
	createEvent,
	EVENTS,
	eventsRoute,
	isPro,
	pairEsign,
	requirePro,
	saveSettings,
	stripePort,
} from "./harness/pro";

// T174f (Events Pro only): a party package, one price for the group ("up to 5 people, £120"), on an event that takes
// booking requests (a date and an AM window, charged in full at request time, T174a/b). The ticket panel's form marks
// the package and a per-person add-on (£10 of shells a person, T174d). The buyer says how many people (3) and takes
// one add-on each: the request is charged £120 + 3 x £10 = £150, takes 3 places, and once the time is confirmed the
// booking has 3 attendees. Through the suite's <BookingWithWaiver>, the same request with a per-person waiver
// (T174e: names after approval) gets 3 attendee rows on the booking page, each to name and sign.

test.describe.configure({ mode: "serial" });

let stripe: FakeStripe | undefined;

test.beforeAll(async ({ request }) => {
	if (!(await isPro(request))) return;
	stripe = await startFakeStripe(stripePort());
	await saveSettings(request, { stripeSecretKey: SECRET_KEY, stripeWebhookSecret: WEBHOOK_SECRET });
});

test.afterAll(async () => {
	await stripe?.close();
});

const REQUESTS = {
	windows: [{ id: "am", label: "AM", start: "10:00", end: "12:00" }],
	days: ["SA", "SU"],
	aheadDays: 60,
	noticeDays: 2,
	closedDates: [],
};

/** A request event with a £120 package for 1 to 5 people and a £10 add-on, marked by Pro's form; the type ids. */
async function packageEvent(request: APIRequestContext, slug: string, signature: Record<string, unknown>) {
	const eventId = await createEvent(request, {
		slug,
		title: "Clay Shoot Party",
		startsAt: "2031-01-01T09:00:00.000Z",
		config: { status: "on_sale", capacity: 20, currency: "GBP", signature, requests: REQUESTS },
		ticketTypes: [
			{ name: "Party package", priceMinor: 12_000, capacity: 20, minPerOrder: 1, maxPerOrder: 5 },
			{ name: "Extra shells", priceMinor: 1000, capacity: 50, sort: 1 },
		],
	});
	const got = await eventsRoute<{ ticketTypes: Array<{ id: string; name: string }> }>(request, "config/get", { eventId });
	const id = (name: string) => got.ticketTypes.find((t) => t.name === name)?.id as string;
	const pkg = id("Party package");
	const shells = id("Extra shells");
	const marked = await request.post(`${EVENTS}/admin`, {
		headers: admin,
		data: {
			type: "form_submit",
			action_id: "addons.save",
			block_id: `event:${eventId}:9:addons`,
			values: { [`addon:${shells}`]: true, [`package:${pkg}`]: true },
		},
	});
	expect(marked.ok()).toBe(true);
	expect(JSON.stringify(await marked.json())).toContain("Add-ons saved");
	return { eventId, pkg, shells };
}

async function visitor(browser: Browser) {
	const context = await browser.newContext({
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	return { context, page: await context.newPage() };
}

/** Runs `act` and returns the Checkout Session the site sent the browser to (see t135-approval-holds.spec.ts). */
async function toCheckout(page: Page, act: () => Promise<void>): Promise<Session> {
	const [req] = await Promise.all([page.waitForRequest((r) => r.url().startsWith(`${CHECKOUT_HOST}/c/`)), act()]);
	const session = stripe?.sessions.get(new URL(req.url()).pathname.split("/").at(-1) as string);
	expect(session, "the session the site created").toBeTruthy();
	return session as Session;
}

/** The signed webhook Stripe sends when the buyer pays, then the return page. */
async function finishCheckout(request: APIRequestContext, page: Page, session: Session) {
	const { body, signature } = (stripe as FakeStripe).complete(session);
	const res = await request.post(`${EVENTS}/webhooks/stripe`, {
		data: body,
		headers: { "content-type": "application/json", "stripe-signature": signature },
	});
	expect(res.status(), await res.text()).toBe(200);
	const back = new URL(session.form.get("success_url") as string);
	await page.goto(`${back.pathname}${back.search}`);
}

async function confirmTime(request: APIRequestContext, id: string, ref: string, day: string) {
	const res = await request.post(`${EVENTS}/admin`, {
		headers: admin,
		data: {
			type: "form_submit",
			action_id: `bookings.confirm:${id}`,
			block_id: "Europe/London",
			values: { date: day, start: "10:30", end: "12:00" },
		},
	});
	expect(res.ok()).toBe(true);
	expect(JSON.stringify(await res.json())).toContain(`${ref}: confirmed`);
}

/** Places the package type has taken: its capacity (20) less what `public/event` says is left. */
async function placesTaken(request: APIRequestContext, eventId: string, pkg: string) {
	const res = await request.get(`${EVENTS}/public/event?eventId=${encodeURIComponent(eventId)}`);
	const reply = (await res.json()) as { data?: unknown };
	const event = (reply.data ?? reply) as { ticketTypes: Array<{ id: string; available?: number | null }> };
	return 20 - (event.ticketTypes.find((t) => t.id === pkg)?.available ?? 20);
}

test("T174f a 3-person £120 package with one add-on each: £150 charged at request, 3 places, 3 attendees", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const slug = `t174f-party-${Date.now().toString(36)}`;
	const { eventId, pkg, shells } = await packageEvent(request, slug, { required: false });
	const { context, page } = await visitor(browser);
	await page.goto(`/events/${slug}`);
	const widget = page.getByTestId("booking-widget");
	const people = widget.getByLabel(/Party package/);
	await expect(widget.getByText("How many people?")).toBeVisible();
	await expect(widget.getByText("£120.00 for the group")).toBeVisible();
	await expect(people).toHaveAttribute("max", "5");
	const extra = widget.getByTestId("booking-addons").getByLabel(/Extra shells/);
	await people.fill("3");
	await expect(extra).toHaveAttribute("max", "3");
	await extra.fill("3");
	await expect(widget.locator("[data-total-value]")).toHaveText("£150.00");
	const date = widget.getByLabel("Date", { exact: true });
	const day = (await date.locator("option:not([value=''])").first().getAttribute("value")) as string;
	await date.selectOption(day);
	await widget.getByRole("radio", { name: /AM/ }).check();
	await widget.getByLabel("Your name").fill("Grace Hopper");
	await widget.getByLabel("Email").fill(address("t174f-party"));
	const session = await toCheckout(page, () => widget.getByRole("button", { name: "Book" }).click());
	expect(session.amount).toBe(15_000);
	const ref = session.form.get("metadata[bookingRef]") as string;
	const stored = bookingByRef(ref);
	expect(stored.data.lines).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ ticketTypeId: pkg, qty: 1, unitPriceMinor: 12_000, people: 3 }),
			expect.objectContaining({ ticketTypeId: shells, qty: 3, unitPriceMinor: 1000, addon: true }),
		]),
	);
	expect(stored.data.totals).toMatchObject({ totalMinor: 15_000 });
	expect(await placesTaken(request, eventId, pkg)).toBe(3);

	await finishCheckout(request, page, session);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "awaiting_approval");
	await confirmTime(request, stored.id, ref, day);
	await page.goto(`/booking?ref=${ref}`);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	expect(attendeesOf(stored.id)).toHaveLength(3);
	await context.close();
});

test("T174f the waiver widget books the package for 3 people; once confirmed each has an attendee row", async ({
	browser,
	request,
	baseURL,
}) => {
	await requirePro(request);
	const templateId = await pairEsign(request, baseURL as string);
	const slug = `t174f-party-waiver-${Date.now().toString(36)}`;
	const { pkg } = await packageEvent(request, slug, { required: true, templateId, mode: "each_attendee" });
	const { context, page } = await visitor(browser);
	await page.goto(`/e2e/waiver?slug=${slug}`);
	const widget = page.getByTestId("booking-with-waiver");
	await expect(widget.getByTestId("waiver-later")).toBeVisible();
	await expect(widget.getByLabel("Ticket")).toHaveValue(pkg);
	await widget.getByLabel("How many people?").fill("3");
	await widget.getByTestId("waiver-addons").getByLabel(/Extra shells/).fill("3");
	const date = widget.getByLabel("Date", { exact: true });
	const day = (await date.locator("option:not([value=''])").first().getAttribute("value")) as string;
	await date.selectOption(day);
	await widget.getByRole("radio", { name: /AM/ }).check();
	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Your email").fill(address("t174f-waiver"));
	const session = await toCheckout(page, () => widget.getByRole("button", { name: "Book" }).click());
	expect(session.amount).toBe(15_000);
	const ref = session.form.get("metadata[bookingRef]") as string;
	const stored = bookingByRef(ref);
	expect(stored.data.waiver).toMatchObject({ after: true });

	await finishCheckout(request, page, session);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "awaiting_approval");
	await confirmTime(request, stored.id, ref, day);
	await page.goto(`/booking?ref=${ref}`);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("attendee-list").getByTestId("attendee-row")).toHaveCount(3);
	expect(attendeesOf(stored.id)).toHaveLength(3);
	await context.close();
});
