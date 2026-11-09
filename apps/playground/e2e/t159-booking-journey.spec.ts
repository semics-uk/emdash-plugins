import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test } from "@playwright/test";

import { CHECKOUT_HOST, type FakeStripe, SECRET_KEY, type Session, startFakeStripe, WEBHOOK_SECRET } from "./harness/fake-stripe";
import { address, BOOKING_URL, createEvent, EVENTS, isPro, pairEsign, saveSettings, stripePort } from "./harness/pro";

// T159 (rc.8 staging check). Nothing gets past Turnstile on LMSC staging, so the confirmed page and its printout
// could not be checked there. This journey gets as close to LMSC as the harness allows, with no third party on
// the network: Turnstile on (the browser gets a stand-in api.js that puts a token in the form; the server's
// siteverify is answered by e2e/harness/stripe-preload.mjs, which passes only that token), the suite's
// <BookingWithWaiver>, and on the Pro build (EMDASH_PRO_DIR) a waiver signed in the flow and a paid ticket
// through the fake Stripe. On the Free build (CI) the same journey runs without the waiver and the payment,
// which are Pro. Then the confirmed page is checked (same card edges, the payment box and attendee list on Pro,
// the QR pass and "Show the code to type in", no sideways scroll at 375 px) and printed with page.pdf() (A4).
// Also: the calendar keeps its size in a wide column (BookingWidget and BookingWithWaiver).
// `T159_SHOTS=1` writes the PDF and screenshots to tasks/evidence/T159/.

test.describe.configure({ mode: "serial" });

const EVIDENCE = resolve(process.cwd(), "../../tasks/evidence/T159");
const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };
const WIDE = { width: 1568, height: 1000 };
const SAVE = process.env.T159_SHOTS === "1";
// Cloudflare's published always-pass site key (the browser never loads Cloudflare: see TURNSTILE_STUB).
const SITE_KEY = "1x00000000000000000000AA";
const SECRET = "e2e-turnstile-secret";
// The one token the server's stand-in siteverify passes (TURNSTILE_PASS in e2e/harness/stripe-preload.mjs).
const TURNSTILE_PASS = "e2e-turnstile-pass";
const PRO_SLUG = "t159-shooting-taster";
// A4 less the 15 mm @page margin on each side, in CSS px (96 per inch): 180 mm.
const A4_CONTENT = Math.floor((180 / 25.4) * 96);

async function shot(page: Page, name: string, fullPage = true) {
	if (!SAVE) return;
	mkdirSync(EVIDENCE, { recursive: true });
	await page.screenshot({ path: resolve(EVIDENCE, `${name}.png`), fullPage });
}

/** Turnstile's api.js, offline: a box of Turnstile's size and the token Turnstile would add to the form. */
const turnstileStub = (token: string) => `document.querySelectorAll(".cf-turnstile").forEach(function (el) {
	var compact = el.getAttribute("data-size") === "compact";
	var box = document.createElement("div");
	box.setAttribute("data-turnstile-stub", "");
	box.style.cssText = "width:" + (compact ? 150 : 300) + "px;height:" + (compact ? 140 : 65) + "px;border:1px solid #888;background:#fafafa";
	var input = document.createElement("input");
	input.type = "hidden";
	input.name = "cf-turnstile-response";
	input.value = ${JSON.stringify(token)};
	el.appendChild(box);
	el.appendChild(input);
});`;

/** A visitor with its own IP. Every request leaving the site is answered here or refused, and recorded. */
async function visitor(browser: Browser, token = TURNSTILE_PASS) {
	const context = await browser.newContext({
		viewport: DESKTOP,
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	const outside: string[] = [];
	await context.route(
		(url) => !["127.0.0.1", "localhost"].includes(url.hostname),
		(route) => {
			const url = new URL(route.request().url());
			outside.push(`${url.origin}${url.pathname}`);
			if (url.href.startsWith("https://challenges.cloudflare.com/turnstile/v0/api.js")) {
				return route.fulfill({ status: 200, contentType: "text/javascript", body: turnstileStub(token) });
			}
			return route.abort();
		},
	);
	return { context, page: await context.newPage(), outside };
}

const noSideways = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const box = async (l: Locator) => {
	const b = await l.boundingBox();
	if (!b) throw new Error("no box");
	return b;
};

const lines = (l: Locator) =>
	l.evaluate((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)));

// --- 1. the calendar in a wide column ---------------------------------------------------------------

test("T159 the calendar keeps its size in a wide column while the widget fills it", async ({ browser }) => {
	for (const [name, path, id] of [
		["events", "/e2e/picker?host=wide", "booking-widget"],
		["waiver", "/e2e/waiver-picker?host=wide", "booking-with-waiver"],
	] as const) {
		const context = await browser.newContext({ viewport: WIDE });
		const page = await context.newPage();
		await page.goto(path);
		const column = await box(page.getByTestId("host-column"));
		const widget = page.getByTestId(id).first();
		expect(column.width).toBeGreaterThan(900);
		expect(Math.abs((await box(widget)).width - column.width), name).toBeLessThanOrEqual(1);
		const calendar = widget.locator(".semics-calendar");
		const day = widget.locator("button[data-day]").first();
		await expect(day).toBeVisible();
		const cal = await box(calendar);
		const cell = await box(day);
		// Seven columns of square-ish days: 44 px at least (target size), not stretched past 64 px.
		expect(cell.width, `${name} day width`).toBeGreaterThanOrEqual(44);
		expect(cell.width, `${name} day width`).toBeLessThanOrEqual(64);
		expect(cal.width, `${name} calendar width`).toBeLessThanOrEqual(480);
		// The month and its Earlier / Later links sit over the calendar, not across the column.
		const nav = widget.locator(".semics-picker-nav");
		if (await nav.isVisible()) expect((await box(nav)).width, `${name} nav`).toBeLessThanOrEqual(cal.width);
		await shot(page, `calendar-${name}-wide-host`, false);

		// On a phone the calendar still takes the form's whole width.
		await page.setViewportSize(MOBILE);
		const small = await box(calendar);
		const form = await box(widget.locator("form").first());
		expect(small.width, `${name} 375`).toBeGreaterThan(form.width - 48);
		expect(await noSideways(page)).toBeLessThanOrEqual(0);
		await context.close();
	}
});

// --- 3. the booking journey ---------------------------------------------------------------------------

let stripe: FakeStripe | undefined;
let pro = false;

test.beforeAll(async ({ request, baseURL }) => {
	pro = await isPro(request);
	await saveSettings(request, { turnstileSiteKey: SITE_KEY, turnstileSecretKey: SECRET });
	if (!pro) return;
	stripe = await startFakeStripe(stripePort());
	await saveSettings(request, { stripeSecretKey: SECRET_KEY, stripeWebhookSecret: WEBHOOK_SECRET });
	const templateId = await pairEsign(request, baseURL as string);
	await createEvent(request, {
		slug: PRO_SLUG,
		title: "Clay Shooting Taster",
		startsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
		config: {
			status: "on_sale",
			capacity: 20,
			currency: "GBP",
			signature: { required: true, templateId, mode: "each_attendee" },
		},
		ticketTypes: [{ name: "Taster session", priceMinor: 4500, capacity: 20, maxPerOrder: 4 }],
	});
});

test.afterAll(async ({ request }) => {
	// Turnstile off again for the specs that follow (they book without a token).
	await saveSettings(request, { turnstileSiteKey: "", turnstileSecretKey: "" });
	await stripe?.close();
});

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

/** Signs the ceremony on screen. */
async function signCeremony(page: Page, name: string) {
	await expect(page.getByTestId("signing-ceremony")).toHaveAttribute("data-state", "ready");
	await page.getByLabel("Type your full name to sign").fill(name);
	await page.getByLabel(/electronic records and an electronic signature/).check();
	await page.getByLabel(/I intend/).check();
	await page.getByRole("button", { name: "Sign document" }).click();
}

const BUYER = "Annie Oakley";

/** Fills <BookingWithWaiver> and presses Book (Pro: two people, both signing on this device: buyer and a child). */
async function fillAndBook(page: Page, email: string) {
	const widget = page.getByTestId("booking-with-waiver");
	await expect(widget.locator(".cf-turnstile [data-turnstile-stub]")).toHaveCount(1);
	await expect(widget.locator(".cf-turnstile")).toHaveAttribute("data-theme", "light");
	await expect(widget.locator(".cf-turnstile")).not.toHaveAttribute("data-size", "compact");
	await widget.getByLabel("Your name").fill(BUYER);
	await widget.getByLabel("Your email").fill(email);
	if (pro) {
		await widget.getByLabel("Attendee 1 Name").fill(BUYER);
		await widget.getByRole("button", { name: "Add another person" }).click();
		await widget.getByLabel("Attendee 2 Name").fill("Billy Oakley");
		await widget.getByLabel("Attendee 2 is Under 18").check();
	} else {
		await widget.getByLabel("How many").fill("2");
	}
	await shot(page, "journey-widget-desktop");
	await widget.getByRole("button", { name: "Book", exact: true }).click();
}

const PAGE = () => (pro ? `/e2e/waiver?slug=${PRO_SLUG}` : "/e2e/waiver?slug=london-meetup");

test("T159 Turnstile is checked on the server: a token it does not pass books nothing", async ({ browser }) => {
	const { context, page, outside } = await visitor(browser, "a-token-siteverify-refuses");
	await page.goto(PAGE());
	await fillAndBook(page, address("refused"));
	await expect(page).toHaveURL(/waiver_error=TURNSTILE_FAILED/);
	await expect(page.getByTestId("waiver-alert")).toContainText("security check");
	expect(outside.every((u) => u === "https://challenges.cloudflare.com/turnstile/v0/api.js")).toBe(true);
	await context.close();
});

test("T159 the booking journey: Turnstile, book, sign, pay, confirmed; the page and its A4 printout", async ({ browser, request }) => {
	const { context, page, outside } = await visitor(browser);
	await page.goto(PAGE());
	const email = address("annie");
	if (pro) {
		// Book → the waivers (the buyer's, then the child's with the buyer as guardian) → Stripe Checkout.
		await fillAndBook(page, email);
		await page.waitForURL(/\/_events\/waiver\?ref=[0-9A-Z]{10}/);
		await signCeremony(page, BUYER);
		await expect(page.getByText("Signing as guardian for")).toContainText("Billy Oakley");
		const [checkout] = await Promise.all([
			page.waitForRequest((r) => r.url().startsWith(`${CHECKOUT_HOST}/c/`)),
			signCeremony(page, BUYER),
		]);
		const session = stripe?.sessions.get(new URL(checkout.url()).pathname.split("/").at(-1) as string);
		expect(session, "the Checkout Session the site created").toBeTruthy();
		expect(session?.amount).toBe(9000);
		await finishCheckout(request, page, session as Session);
	} else {
		await fillAndBook(page, email);
	}
	await expect(page).toHaveURL(BOOKING_URL);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");

	// --- the confirmed page, desktop
	const passes = page.getByTestId("ticket-pass");
	await expect(passes).toHaveCount(2);
	if (pro) {
		await expect(page.getByTestId("payment-return")).toContainText("Payment received");
		await expect(page.getByTestId("attendee-list")).toBeVisible();
		await expect(page.getByTestId("attendee-row")).toHaveCount(2);
	}
	const cards = async () =>
		page.locator("main > section").evaluateAll((els) =>
			els
				.filter((el) => el.getBoundingClientRect().height > 0)
				.map((el) => {
					const r = el.getBoundingClientRect();
					const s = getComputedStyle(el);
					return {
						left: Math.round(r.left),
						right: Math.round(r.right),
						border: `${s.borderTopWidth} ${s.borderTopColor}`,
						radius: s.borderTopLeftRadius,
						padding: s.paddingInlineStart,
					};
				}),
		);
	const same = async (label: string) => {
		const all = await cards();
		expect(all.length, label).toBeGreaterThanOrEqual(pro ? 4 : 2);
		for (const card of all.slice(1)) expect(card, label).toEqual(all[0]);
	};
	await same("desktop");
	const pass = passes.first();
	if (pro) {
		await expect(pass.getByTestId("ticket-qr")).toBeVisible();
		await expect(pass.getByTestId("ticket-code")).toBeHidden();
	}
	await shot(page, "confirmed-desktop");
	if (pro) {
		await pass.getByText("Show the code to type in").click();
	}
	const code = pass.getByTestId("ticket-code");
	await expect(code).toBeVisible();
	const value = (await code.textContent()) as string;
	expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(await lines(code), "the code on one line on a desktop").toBe(1);

	// --- 375 px
	await page.setViewportSize(MOBILE);
	expect(await noSideways(page), "no sideways scroll at 375 px").toBeLessThanOrEqual(0);
	await same("375");
	await shot(page, "confirmed-375");

	// --- print: A4 width, then the PDF itself
	await page.setViewportSize({ width: A4_CONTENT, height: 1000 });
	await page.emulateMedia({ media: "print" });
	await expect(page.locator(".semics-page-brand")).toBeHidden();
	expect(await page.locator("main button:visible, main form:visible, .semics-page-brand:visible").count(), "no buttons").toBe(0);
	const past = await page.evaluate((width) => {
		const out: string[] = [];
		for (const el of document.querySelectorAll("body *")) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0 && r.right > width + 0.5) out.push(`${el.tagName}.${el.className} ${Math.round(r.right)}`);
		}
		return out;
	}, A4_CONTENT);
	expect(past, "nothing past the right edge of an A4 page").toEqual([]);
	expect(await noSideways(page)).toBeLessThanOrEqual(0);
	const printed = pro ? pass.getByTestId("ticket-code-print") : code;
	await expect(printed).toBeVisible();
	expect(await printed.textContent()).toBe(value);
	expect(await lines(printed), "the check-in code on one line in print").toBe(1);
	await shot(page, "confirmed-print-a4");

	const pdf = await page.pdf({ format: "A4", printBackground: true });
	const text = pdf.toString("latin1");
	const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
	expect(pages, "pages").toBeGreaterThanOrEqual(1);
	expect(pages, "pages").toBeLessThanOrEqual(pro ? 3 : 2);
	// Every page is A4: 210 x 297 mm, 595.3 x 841.9 pt (Chrome rounds to whole CSS px: 595.92 x 842.88).
	const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
	expect(boxes.length).toBeGreaterThanOrEqual(pages);
	for (const [, w, h] of boxes) {
		expect(Math.abs(Number(w) - 595.3)).toBeLessThan(2);
		expect(Math.abs(Number(h) - 841.9)).toBeLessThan(2);
	}
	if (SAVE) {
		mkdirSync(EVIDENCE, { recursive: true });
		writeFileSync(resolve(EVIDENCE, `confirmed-${pro ? "pro" : "free"}.pdf`), pdf);
	}

	// No third party was reached: only Turnstile's script (answered here) and, on Pro, the fake Checkout page.
	const allowed = ["https://challenges.cloudflare.com/turnstile/v0/api.js", ...(pro ? [CHECKOUT_HOST] : [])];
	expect(outside.filter((u) => !allowed.some((a) => u.startsWith(a)))).toEqual([]);
	await context.close();
});
