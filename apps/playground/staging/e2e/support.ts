// Shared steps of the staging suite (T111). Runs against a deployed staging site (STAGING_URL) or,
// with STAGING_LOCAL=1, against the local playground built the same way (see staging/target.mjs).
// A deployed site has no `/e2e/*` helper routes and every visitor shares the runner's IP, so these
// steps book at most a handful of tickets and never depend on X-Forwarded-For.
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

import { stagingTarget } from "../target.mjs";

export const target = stagingTarget(process.env);
export const EVENTS_API = "/_emdash/api/plugins/semics-events";
export const BOOKING_URL = /\/booking\?ref=([0-9A-Z]{10})$/;

/** A unique address per run, so a re-run on the same database never finds an older email. */
export const address = (who: string) => `${who}-${Date.now().toString(36)}@example.com`;

export async function visitor(browser: Browser, javaScriptEnabled = false) {
	const context = await browser.newContext({ javaScriptEnabled });
	return { context, page: await context.newPage() };
}

/** Books one ticket through the real no-JS widget and returns the booking ref. */
export async function book(page: Page, slug: string, ticket: RegExp, name: string, email: string): Promise<string> {
	await page.goto(`/events/${slug}`);
	await page.getByLabel(ticket).fill("1");
	await page.getByLabel("Your name").fill(name);
	await page.getByLabel("Email").fill(email);
	await page.getByTestId("booking-widget").getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(BOOKING_URL);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	return BOOKING_URL.exec(page.url())?.[1] ?? "";
}

export async function eventIdFor(request: APIRequestContext, slug: string): Promise<string> {
	const body = (await (await request.get(`${EVENTS_API}/public/events`)).json()) as {
		data?: { events?: Array<{ slug: string; eventId: string }> };
	};
	const event = body.data?.events?.find((e) => e.slug === slug);
	if (!event) throw new Error(`no listed event ${slug}`);
	return event.eventId;
}

export const adminHeaders = () => ({
	authorization: `Bearer ${target.adminToken}`,
	"x-emdash-request": "1",
});

/** Whether the site runs Events Pro: its private `pro/licence` route answers `edition: "pro"`. */
export async function runsPro(request: APIRequestContext): Promise<boolean> {
	if (!target.adminToken) return false;
	const res = await request.get(`${EVENTS_API}/pro/licence`, { headers: adminHeaders() });
	if (!res.ok()) return false;
	const body = (await res.json()) as { data?: { edition?: string } };
	return body.data?.edition === "pro";
}

/**
 * Skips a Pro journey on a Free build, unless the run expects Pro (`STAGING_EXPECT_PRO=1`, the
 * nightly), where a Free answer is a failure.
 */
export async function requirePro(request: APIRequestContext) {
	const pro = await runsPro(request);
	if (target.expectPro) expect(pro, "the staging build runs Events Pro (and STAGING_ADMIN_TOKEN is set)").toBe(true);
	test.skip(!pro, "Events Pro is not linked (EMDASH_PRO_DIR) or there is no admin token");
}

interface Mail {
	to: string;
	subject: string;
	text: string;
}

/** Reads a delivered email through the local `/e2e/mail` helper, draining the outbox until it arrives. */
export async function mailTo(request: APIRequestContext, to: string, subject: RegExp): Promise<Mail> {
	for (let tick = 0; tick < 30; tick++) {
		const { messages } = (await (await request.get(`/e2e/mail?to=${encodeURIComponent(to)}`)).json()) as {
			messages: Mail[];
		};
		const found = messages.find((m) => subject.test(m.subject));
		if (found) return found;
		expect((await request.post("/e2e/cron?task=outbox-drain")).ok()).toBe(true);
	}
	throw new Error(`no email "${subject}" to ${to}`);
}

/** The first link in an email's text whose path starts with `prefix`, as a same-site path. */
export function linkIn(mail: Mail, prefix: string): string {
	for (const [raw] of mail.text.matchAll(/https?:\/\/\S+|\/\S+/g)) {
		const url = new URL(raw, "http://site.invalid");
		if (url.pathname.startsWith(prefix)) return `${url.pathname}${url.search}`;
	}
	throw new Error(`no ${prefix} link in "${mail.subject}"`);
}
