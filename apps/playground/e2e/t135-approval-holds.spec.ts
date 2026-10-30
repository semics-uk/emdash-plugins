import AxeBuilder from "@axe-core/playwright";
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
	mailTo,
	patchBooking,
	paymentRecord,
	requirePro,
	runCron,
	saveSettings,
	stripePort,
} from "./harness/pro";

// T135 (R97, R98) on the playground built with Events Pro (EMDASH_PRO_DIR), in a real browser against
// the real server, with Stripe faked by e2e/harness/fake-stripe.ts (the server's Stripe requests reach
// it through stripe-preload.mjs; checkout completion is the signed webhook Stripe would send).
//  - An approval event's free booking waits as "Awaiting approval"; the admin's Approve confirms it,
//    Decline declines it, and the sweeper expires one whose deadline passed.
//  - A paid approval event authorises the card (deadline within 6 days): Approve captures it, Decline
//    gives it back, nothing is captured. A later deadline saves the card: a refused off-session charge
//    approves it unpaid, the buyer gets "Pay now", pays, and the booking is confirmed with the attendees
//    typed at checkout (T134: booked through the public routes, one attendee under 18).
// Skipped on the Free build.

test.describe.configure({ mode: "serial" });

const STARTS = "2031-06-12T18:00:00.000Z";
let stripe: FakeStripe | undefined;
const events: Record<"free" | "authorise" | "save", string> = { free: "", authorise: "", save: "" };

test.beforeAll(async ({ request }) => {
	if (!(await isPro(request))) return;
	stripe = await startFakeStripe(stripePort());
	await saveSettings(request, {
		stripeSecretKey: SECRET_KEY,
		stripeWebhookSecret: WEBHOOK_SECRET,
		adminNotifyEmails: "organiser@example.com",
	});
	const event = (slug: string, title: string, priceMinor: number, deadlineHours: number) =>
		createEvent(request, {
			slug,
			title,
			startsAt: STARTS,
			config: {
				status: "on_sale",
				capacity: 20,
				currency: "GBP",
				signature: { required: false },
				approval: { required: true, deadlineHours },
			},
			ticketTypes: [{ name: "Class place", priceMinor, capacity: 20, maxPerOrder: 4 }],
		});
	events.free = await event("t135-vetted-class", "Vetted Pottery Class", 0, 48);
	events.authorise = await event("t135-paid-class", "Paid Life Drawing", 2500, 48);
	events.save = await event("t135-paid-later", "Paid Masterclass", 4000, 720);
});

test.afterAll(async () => {
	await stripe?.close();
});

async function visitor(browser: Browser, javaScriptEnabled = true) {
	const context = await browser.newContext({
		javaScriptEnabled,
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	return { context, page: await context.newPage() };
}

/** Books `qty` places through the event page's widget; a paid booking stops on the Checkout page. */
async function book(page: Page, slug: string, email: string, { paid = false, qty = 1 } = {}) {
	await page.goto(`/events/${slug}`);
	const widget = page.getByTestId("booking-widget");
	await widget.getByLabel(/Class place/).fill(String(qty));
	await widget.getByLabel("Your name").fill("Grace Hopper");
	await widget.getByLabel("Email").fill(email);
	if (paid) {
		const session = await toCheckout(page, () => widget.getByRole("button", { name: "Book" }).click());
		const ref = session.form.get("metadata[bookingRef]") as string;
		return { ref, session };
	}
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(BOOKING_URL);
	return { ref: BOOKING_URL.exec(page.url())?.[1] as string, session: undefined };
}

/**
 * Runs `act` and returns the Checkout Session the site sent the browser to. The session URL's host does
 * not exist (Playwright cannot route a redirect), so the page stops on an error page: the spec plays
 * the buyer's part at Stripe with `finishCheckout`.
 */
async function toCheckout(page: Page, act: () => Promise<void>): Promise<Session> {
	const [request] = await Promise.all([page.waitForRequest((r) => r.url().startsWith(`${CHECKOUT_HOST}/c/`)), act()]);
	const session = stripe?.sessions.get(new URL(request.url()).pathname.split("/").at(-1) as string);
	expect(session, "the session the site created").toBeTruthy();
	return session as Session;
}

/** What Stripe does when the buyer finishes Checkout: the signed webhook, then the return page. */
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

/**
 * Books through the public routes the way a site's own checkout does, with each attendee typed at checkout
 * (the widget names every seat after the buyer), and hands the browser the booking cookie the widget
 * would set. Returns the ref and the Checkout Session the site created.
 */
async function bookWithAttendees(
	request: APIRequestContext,
	page: Page,
	eventId: string,
	buyer: { name: string; email: string },
	attendees: Array<{ name: string; email: string; minor?: boolean }>,
) {
	const ip = { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` };
	const event = await eventsRoute<{ ticketTypes: Array<{ id: string }> }>(request, "public/event", { eventId }, false);
	const ticketTypeId = event.ticketTypes[0]?.id as string;
	const post = async <T>(path: string, data: unknown) => {
		const res = await request.post(`${EVENTS}/${path}`, { data, headers: { "x-emdash-request": "1", ...ip } });
		expect(res.ok(), await res.text()).toBe(true);
		return ((await res.json()) as { data: T }).data;
	};
	const held = await post<{ bookingRef: string; accessToken: string }>("public/checkout/reserve", {
		eventId,
		lines: [{ ticketTypeId, qty: attendees.length }],
		buyer,
		idempotencyKey: `t134-${Date.now().toString(36)}-${"k".repeat(24)}`,
	});
	const next = await post<{ next: { type: string; url: string } }>("public/checkout/continue", {
		bookingRef: held.bookingRef,
		accessToken: held.accessToken,
		attendees: attendees.map((a) => ({ ticketTypeId, ...a })),
	});
	expect(next.next.type).toBe("pay");
	const session = stripe?.sessions.get(new URL(next.next.url).pathname.split("/").at(-1) as string) as Session;
	expect(session, "the session the site created").toBeTruthy();
	const url = test.info().project.use.baseURL as string;
	await page.context().addCookies([{ name: `semics_booking_${held.bookingRef}`, value: held.accessToken, url }]);
	return { ref: held.bookingRef, session };
}

async function decide(request: APIRequestContext, ref: string, how: "approve" | "decline") {
	const { id } = bookingByRef(ref);
	const data =
		how === "approve"
			? { type: "block_action", action_id: "bookings.approve", value: id }
			: { type: "form_submit", action_id: `bookings.decline:${id}`, values: { reason: "The class is for members." } };
	const res = await request.post(`${EVENTS}/admin`, { data, headers: admin });
	expect(res.ok()).toBe(true);
	return JSON.stringify(await res.json());
}

const status = (page: Page) => page.getByTestId("booking-status");

async function axe(page: Page) {
	const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
	return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("R97 a free booking of an approval event waits, the admin approves it, it is confirmed", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const email = address("approve");
	const { context, page } = await visitor(browser);
	const { ref } = await book(page, "t135-vetted-class", email);
	await expect(status(page)).toHaveAttribute("data-status", "awaiting_approval");
	await expect(status(page)).toHaveText(/Awaiting approval/);
	await expect(page.getByTestId("booking-hold")).toBeVisible();
	expect(await axe(page)).toEqual([]);
	await mailTo(request, email, /request/i);

	expect(await decide(request, ref, "approve")).toContain(`${ref}: confirmed`);
	await page.reload();
	await expect(status(page)).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("ticket-pass")).toHaveCount(1);
	await mailTo(request, email, /^Your booking/);
	await context.close();
});

test("R97 the admin declines a request: the buyer's page says Declined, no ticket", async ({ browser, request }) => {
	await requirePro(request);
	const { context, page } = await visitor(browser, false);
	const { ref } = await book(page, "t135-vetted-class", address("decline"));
	await expect(status(page)).toHaveAttribute("data-status", "awaiting_approval");
	expect(await decide(request, ref, "decline")).toContain(`${ref}: declined`);
	await page.reload();
	await expect(status(page)).toHaveAttribute("data-status", "declined");
	await expect(page.getByTestId("ticket-pass")).toHaveCount(0);
	// Too late to approve it now.
	expect(await decide(request, ref, "approve")).toContain("Not changed");
	await context.close();
});

test("R97 a request nobody decided expires when the sweeper passes its deadline", async ({ browser, request }) => {
	await requirePro(request);
	const { context, page } = await visitor(browser);
	const { ref } = await book(page, "t135-vetted-class", address("expire"));
	const { id, data } = bookingByRef(ref);
	expect(data.status).toBe("awaiting_approval");
	const past = new Date(Date.now() - 60_000).toISOString();
	patchBooking(id, { holdExpiresAt: past, approval: { until: past } });
	await runCron(request, "sweep-holds");
	await page.reload();
	await expect(status(page)).toHaveAttribute("data-status", "expired");
	expect(await decide(request, ref, "approve")).toContain("Not changed");
	await context.close();
});

test("R98 a paid request authorises the card; Approve captures it once and confirms", async ({ browser, request }) => {
	await requirePro(request);
	const s = stripe as FakeStripe;
	const { context, page } = await visitor(browser);
	const { ref, session } = await book(page, "t135-paid-class", address("capture"), { paid: true, qty: 2 });
	expect(session.hold).toBe("manual");
	expect(session.form.get("payment_intent_data[capture_method]")).toBe("manual");
	await finishCheckout(request, page, session);
	await expect(status(page)).toHaveAttribute("data-status", "awaiting_approval");
	expect(paymentRecord(session.id)?.status).toBe("authorised");
	expect(s.calls.filter((c) => c.endsWith("/capture"))).toEqual([]);

	expect(await decide(request, ref, "approve")).toContain(`${ref}: confirmed`);
	expect(s.calls.filter((c) => c.endsWith("/capture"))).toEqual([`POST payment_intents/${session.paymentIntent}/capture`]);
	expect(s.intents.get(session.paymentIntent as string)?.status).toBe("succeeded");
	expect(paymentRecord(session.id)?.status).toBe("paid");
	await page.reload();
	await expect(status(page)).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("ticket-pass")).toHaveCount(2);
	// A second approve changes nothing and charges nothing.
	await decide(request, ref, "approve");
	expect(s.calls.filter((c) => c.endsWith("/capture"))).toHaveLength(1);
	await context.close();
});

test("R98 Decline gives the authorisation back: nothing is captured", async ({ browser, request }) => {
	await requirePro(request);
	const s = stripe as FakeStripe;
	const { context, page } = await visitor(browser);
	const { ref, session } = await book(page, "t135-paid-class", address("release"), { paid: true });
	await finishCheckout(request, page, session);
	await expect(status(page)).toHaveAttribute("data-status", "awaiting_approval");

	expect(await decide(request, ref, "decline")).toContain(`${ref}: declined`);
	const pi = session.paymentIntent as string;
	expect(s.calls).toContain(`POST payment_intents/${pi}/cancel`);
	expect(s.calls).not.toContain(`POST payment_intents/${pi}/capture`);
	expect(s.intents.get(pi)?.status).toBe("canceled");
	expect(paymentRecord(session.id)?.status).toBe("released");
	await page.reload();
	await expect(status(page)).toHaveAttribute("data-status", "declined");
	await context.close();
});

test("R98 a later deadline saves the card; a refused charge asks the buyer to Pay now, who pays and is confirmed", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const s = stripe as FakeStripe;
	const email = address("paynow");
	const { context, page } = await visitor(browser);
	// T134: the attendees typed at checkout (one under 18) must survive "Pay now".
	const typed = [
		{ name: "Grace Hopper", email },
		{ name: "Alan Turing", email: address("alan") },
		{ name: "Ada Junior", email, minor: true },
	];
	const { ref, session } = await bookWithAttendees(request, page, events.save, { name: "Grace Hopper", email }, typed);
	const seats = () => attendeesOf(bookingByRef(ref).id).map((a) => ({ name: a.name, email: a.email, minor: a.minor === true }));
	const expected = typed.map((a) => ({ ...a, minor: a.minor === true }));
	expect(seats()).toEqual(expected);
	expect(session.mode).toBe("setup");
	expect(session.hold).toBe("setup");
	await finishCheckout(request, page, session);
	await expect(status(page)).toHaveAttribute("data-status", "awaiting_approval");

	// The bank wants the customer: approved, but unpaid until the buyer pays.
	s.refuseCharges = true;
	try {
		expect(await decide(request, ref, "approve")).toContain(`${ref}: approved, awaiting payment`);
	} finally {
		s.refuseCharges = false;
	}
	expect(s.calls.filter((c) => c === "POST payment_intents")).toHaveLength(1);
	expect(paymentRecord(session.id)?.status).toBe("released");
	const mail = await mailTo(request, email, /pay/i);
	expect(mail.text).toContain("/booking?ref=");

	expect(seats()).toEqual(expected);

	await page.goto(`/booking?ref=${ref}`);
	await expect(status(page)).toHaveAttribute("data-status", "awaiting_payment");
	// The booking page names the ticket type, never its id (T135 follow-up).
	await expect(page.getByTestId("booking-details")).toContainText("3 × Class place");
	await page.setViewportSize({ width: 320, height: 640 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	expect(await axe(page)).toEqual([]);
	const payNow = await toCheckout(page, () => page.getByRole("button", { name: "Pay now" }).click());
	expect(payNow.id).not.toBe(session.id);
	expect(payNow.mode).toBe("payment");
	expect(payNow.hold).toBeNull();
	expect(payNow.amount).toBe(12000);
	// Pay now only re-ran the payment step: every seat is still the person typed at checkout.
	expect(seats()).toEqual(expected);
	await finishCheckout(request, page, payNow);
	await expect(status(page)).toHaveAttribute("data-status", "confirmed");
	expect(paymentRecord(payNow.id)?.status).toBe("paid");
	expect(seats()).toEqual(expected);
	await expect(page.getByTestId("ticket-pass")).toHaveCount(3);
	for (const a of typed) await expect(page.getByTestId("booking-page")).toContainText(a.name);
	await context.close();
});
