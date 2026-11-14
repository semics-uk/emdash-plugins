import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { createAndSend, waitForCompletionToken, signViaRoutes } from "./harness/esign-journey";
import { CHECKOUT_HOST, type FakeStripe, SECRET_KEY, startFakeStripe, WEBHOOK_SECRET } from "./harness/fake-stripe";
import { address, createEvent, isPro, pairEsign, saveSettings, stripePort } from "./harness/pro";

// T169 (LMSC staging, 2026-11-14). 1. e-sign's own pages (/sign/<token>, /signed/<token>, /verify) had no theme:
// the browser's Times New Roman and blue links. They now carry the suite's page sheet (the site's theme), its brand
// and organiser footer, with the sheet allowed by hash in their CSP. 2. A signed-in editor got EmDash's visual-edit
// toolbar injected into those pages, where their CSP leaves it unstyled; it is kept off them. 3. Pressing Book on a
// paid booking showed a page for a moment before Stripe Checkout: the waiver page's "Continue to payment" hand-off,
// which only a post from the signing page needs. The booking form now goes straight to Checkout; after the last
// signature the hand-off is a themed card. `T169_SHOTS=1` writes screenshots to tasks/evidence/T169/.

test.describe.configure({ mode: "serial" });

const EVIDENCE = resolve(process.cwd(), "../../tasks/evidence/T169");
const SAVE = process.env.T169_SHOTS === "1";

async function shot(page: Page, name: string) {
	if (!SAVE) return;
	mkdirSync(EVIDENCE, { recursive: true });
	await page.screenshot({ path: resolve(EVIDENCE, `${name}.png`), fullPage: true });
}

/** The page's look as the browser computed it. */
const look = (page: Page) =>
	page.evaluate(() => {
		const body = getComputedStyle(document.body);
		return {
			font: body.fontFamily,
			background: body.backgroundColor,
			bodyClass: document.body.className,
			// The comment before the doctype must not put the page in quirks mode.
			mode: document.compatMode,
		};
	});

/** Signs the browser context in as the seeded admin through the real magic-link flow (mail capture), as T145 does. */
async function signIn(page: Page, baseURL: string) {
	const origin = { origin: baseURL, "x-forwarded-for": "198.51.100.169" };
	const sent = await page.request.post("/_emdash/api/auth/magic-link/send", {
		data: { email: "admin@example.com" },
		headers: origin,
	});
	expect(sent.ok(), await sent.text()).toBe(true);
	let token: string | undefined;
	for (let i = 0; i < 20 && !token; i++) {
		const { messages } = (await (await page.request.get("/e2e/mail?to=admin%40example.com")).json()) as {
			messages: Array<{ text?: string; html?: string }>;
		};
		const last = messages.at(-1);
		token = /[?&]token=([A-Za-z0-9_-]+)/.exec(`${last?.text ?? ""} ${last?.html ?? ""}`)?.[1];
		if (!token) await page.waitForTimeout(250);
	}
	expect(token, "magic link token").toBeDefined();
	const verified = await page.request.post("/_emdash/api/auth/magic-link/verify", { data: { token }, headers: origin });
	expect(verified.ok(), await verified.text()).toBe(true);
}

test("T169 /sign/<token> takes the site's look: the page sheet, a card, no browser defaults", async ({ page, request }) => {
	const sent = await createAndSend(request, "T169 themed waiver");
	const response = await page.goto(`/sign/${sent.token}`);
	await expect(page.getByTestId("signing-ceremony")).toHaveAttribute("data-state", "ready");
	const seen = await look(page);
	expect(seen.bodyClass).toBe("semics-page");
	expect(seen.mode).toBe("CSS1Compat");
	await expect(page.locator('head meta[name="referrer"][content="no-referrer"]')).toHaveCount(1);
	expect(seen.font).not.toMatch(/times/i);
	expect(seen.font).toMatch(/system-ui|sans-serif/);
	// The page background is the sheet's (`--events-page-bg`), not the browser's white.
	expect(seen.background).not.toBe("rgba(0, 0, 0, 0)");
	expect(seen.background).not.toBe("rgb(255, 255, 255)");
	const csp = response?.headers()["content-security-policy"] ?? "";
	expect(csp).not.toMatch(/unsafe-inline/);
	// The inline sheet is allowed by hash: nothing on the page was blocked.
	const blocked: string[] = [];
	page.on("console", (m) => {
		if (/Content Security Policy/i.test(m.text())) blocked.push(m.text());
	});
	await page.reload();
	await expect(page.getByTestId("signing-ceremony")).toBeVisible();
	expect(blocked).toEqual([]);
	await shot(page, "sign-page");
});

test("T169 /signed/<token> and /verify take the same look", async ({ page, request }) => {
	const sent = await createAndSend(request, "T169 signed copy");
	await signViaRoutes(request, sent);
	const copy = await waitForCompletionToken(request, sent);
	await page.goto(`/signed/${copy}`);
	await expect(page.getByTestId("signed-copy-page")).toBeVisible();
	expect((await look(page)).font).not.toMatch(/times/i);
	expect((await look(page)).bodyClass).toBe("semics-page");
	await shot(page, "signed-copy-page");

	await page.goto("/verify");
	await expect(page.getByTestId("verify-page")).toBeVisible();
	const seen = await look(page);
	expect(seen.bodyClass).toBe("semics-page");
	expect(seen.mode).toBe("CSS1Compat");
	expect(seen.font).not.toMatch(/times/i);
	await shot(page, "verify-page");
});

test("T169 a signed-in editor gets no EmDash toolbar on the signing pages (it still shows on the site's own)", async ({
	page,
	request,
	baseURL,
}) => {
	const sent = await createAndSend(request, "T169 editor visit");
	await signIn(page, baseURL as string);
	await page.goto("/");
	await expect(page.locator("#emdash-toolbar")).toHaveCount(1);
	for (const path of [`/sign/${sent.token}`, "/verify", "/_events/waiver?ref=ABCDEFGHJK&error=SIGNING_UNAVAILABLE"]) {
		const response = await page.goto(path);
		expect(response?.status(), path).toBeLessThan(500);
		expect(new URL(page.url()).pathname, path).toBe(path.split("?")[0]);
		await expect(page.locator("#emdash-toolbar"), path).toHaveCount(0);
		expect(await response?.text(), path).not.toContain("emdash-toolbar");
	}
});

// --- 3. the pay hand-off (Pro: paid tickets through the fake Stripe) ----------------------------------

let stripe: FakeStripe | undefined;
let pro = false;
let template = "";

test.beforeAll(async ({ request, baseURL }) => {
	pro = await isPro(request);
	if (!pro) return;
	stripe = await startFakeStripe(stripePort());
	await saveSettings(request, { stripeSecretKey: SECRET_KEY, stripeWebhookSecret: WEBHOOK_SECRET });
	template = await pairEsign(request, baseURL as string);
});

test.afterAll(async () => {
	await stripe?.close();
});

/**
 * A visitor whose requests off the site are answered here, and recorded. The fake Checkout answers 204 No Content,
 * which a browser does not navigate to, so a page that sends the buyer there stays on screen to be checked.
 */
async function visitor(browser: Browser) {
	const context = await browser.newContext({
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	const checkout: string[] = [];
	await context.route(
		(url) => !["127.0.0.1", "localhost"].includes(url.hostname),
		(route) => {
			if (route.request().url().startsWith(`${CHECKOUT_HOST}/c/`)) {
				checkout.push(route.request().url());
				return route.fulfill({ status: 204 });
			}
			return route.abort();
		},
	);
	return { context, page: await context.newPage(), checkout };
}

async function paidEvent(request: Parameters<typeof createEvent>[0], slug: string, days: number) {
	await createEvent(request, {
		slug,
		title: "Clay Shooting Taster",
		startsAt: new Date(Math.floor(Date.now() / 86_400_000 + days) * 86_400_000 + 10 * 3_600_000).toISOString(),
		config: {
			status: "on_sale",
			capacity: 20,
			currency: "GBP",
			signature: { required: true, templateId: template, mode: "each_attendee" },
		},
		ticketTypes: [{ name: "Taster session", priceMinor: 4500, capacity: 20, maxPerOrder: 4 }],
	});
}

async function book(page: Page, email: string) {
	const widget = page.getByTestId("booking-with-waiver");
	await widget.getByLabel("Your name").fill("Annie Oakley");
	await widget.getByLabel("Your email").fill(email);
	await widget.getByLabel("Attendee 1 Name").fill("Annie Oakley");
	await widget.getByRole("button", { name: "Book", exact: true }).click();
}

test("T169 pay first: Book goes straight to Stripe Checkout, with no page between", async ({ browser, request }) => {
	test.skip(!pro, "Events Pro is not linked (build with EMDASH_PRO_DIR=<Pro checkout>)");
	await paidEvent(request, "t169-pay-first", 16);
	await saveSettings(request, { waiverTiming: "after-payment" });
	try {
		const { context, page, release } = await visitor(browser);
		await page.goto("/e2e/waiver?slug=t169-pay-first");
		const pages: string[] = [];
		page.on("response", (r) => {
			if (r.request().isNavigationRequest() && r.status() === 200) pages.push(new URL(r.url()).pathname);
		});
		// A redirected request skips the context's route (Playwright routes only a chain's first request), so the
		// browser's request to Checkout is awaited rather than its page.
		const [posted, checkout] = await Promise.all([
			page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/_events/waiver")),
			page.waitForRequest((r) => r.url().startsWith(`${CHECKOUT_HOST}/c/`)),
			book(page, address("t169-first")),
		]);
		expect(posted.status()).toBe(303);
		expect(posted.headers().location).toMatch(new RegExp(`^${CHECKOUT_HOST}/c/`));
		// The browser went from the POST to Checkout itself: the redirect chain has no page between.
		expect(checkout.redirectedFrom()?.url()).toContain("/_events/waiver");
		expect(pages.filter((p) => p.startsWith("/_events/"))).toEqual([]);
		await context.close();
	} finally {
		await saveSettings(request, { waiverTiming: "before-payment" });
	}
});

test("T169 sign first: after the last signature a themed 'Taking you to secure payment' card, then Checkout", async ({
	browser,
	request,
}) => {
	test.skip(!pro, "Events Pro is not linked (build with EMDASH_PRO_DIR=<Pro checkout>)");
	await paidEvent(request, "t169-sign-first", 17);
	const { context, page, checkout } = await visitor(browser);
	await page.goto("/e2e/waiver?slug=t169-sign-first");
	await book(page, address("t169-sign"));
	await page.waitForURL(/\/_events\/waiver\?ref=[0-9A-Z]{10}/);
	await expect(page.getByTestId("signing-ceremony")).toHaveAttribute("data-state", "ready");
	await page.getByLabel("Type your full name to sign").fill("Annie Oakley");
	await page.getByLabel(/electronic records and an electronic signature/).check();
	await page.getByLabel(/I intend/).check();
	await page.getByRole("button", { name: "Sign document" }).click();

	const handOff = page.getByTestId("waiver-page");
	await expect(handOff).toHaveAttribute("data-step", "pay");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Taking you to secure payment…");
	const card = page.locator(".semics-pay-handoff");
	await expect(card).toBeVisible();
	const button = page.getByTestId("waiver-pay-link");
	await expect(button).toHaveAttribute("href", new RegExp(`^${CHECKOUT_HOST}/c/`));
	const styles = await button.evaluate((el) => {
		const s = getComputedStyle(el);
		return { display: s.display, background: s.backgroundColor, decoration: s.textDecorationLine };
	});
	expect(styles.display).toBe("inline-block");
	expect(styles.decoration).toBe("none");
	expect(styles.background).not.toBe("rgba(0, 0, 0, 0)");
	expect((await look(page)).font).not.toMatch(/times/i);
	// The page's meta refresh asked for Checkout by itself (the fake answers 204, so the card stays to be checked).
	await expect.poll(() => checkout.length).toBeGreaterThan(0);
	expect(checkout[0]).toBe(await button.getAttribute("href"));
	await shot(page, "pay-handoff");
	await context.close();
});
