import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

import {
	address,
	BOOKING_URL,
	createEvent,
	isPro,
	mailbox,
	pairEsign,
	requirePro,
	runCron,
	saveSettings,
} from "./harness/pro";

// T135 (R95) on the playground built with Events Pro (EMDASH_PRO_DIR) and the Free e-sign core: the
// booking page lists a per-attendee waiver booking's attendees as Signed / Waiting. The buyer books
// three seats through the suite's <BookingWithWaiver> (themselves, another adult signing by email, a
// child), signs their own waiver in the flow, then on `/booking`: Sign now signs the child's (the
// buyer as guardian) on the same device; Resend emails the adult again; a misspelt email is corrected
// before the cutoff and refused after it. The same list works without JavaScript (receipts come back
// through the page's reconcile with e-sign). axe and 320 px on the list. Skipped on the Free build.

test.describe.configure({ mode: "serial" });

const SLUG = "t135-climbing-day";
const WAIVER_PAGE = `/e2e/waiver?slug=${SLUG}`;

test.beforeAll(async ({ request, baseURL }) => {
	if (!(await isPro(request))) return;
	const templateId = await pairEsign(request, baseURL as string);
	await saveSettings(request, { attendeeEditCutoffHours: 24 });
	await createEvent(request, {
		slug: SLUG,
		title: "Family Climbing Day",
		// Ten days ahead: inside a 720-hour cutoff, well outside the default 24 hours.
		startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
		config: {
			status: "on_sale",
			capacity: 40,
			currency: "GBP",
			signature: { required: true, templateId, mode: "each_attendee" },
		},
		ticketTypes: [{ name: "Climber", priceMinor: 0, capacity: 40, maxPerOrder: 6 }],
	});
});

async function visitor(browser: Browser, javaScriptEnabled: boolean) {
	const context = await browser.newContext({
		javaScriptEnabled,
		extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
	});
	return { context, page: await context.newPage() };
}

interface Party {
	buyer: string;
	adult: string;
}

/** Books the buyer, another adult (signs by email) and a child; returns the booking ref. */
async function bookParty(page: Page, who: Party): Promise<string> {
	await page.goto(WAIVER_PAGE);
	const widget = page.getByTestId("booking-with-waiver");
	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Your email").fill(who.buyer);
	await widget.getByLabel("Attendee 1 Name").fill("Ada Lovelace");
	await widget.getByLabel("Attendee 2 Name").fill("Charles Babage");
	await widget.getByLabel("Attendee 2 Email (optional)").fill(who.adult);
	await widget.getByLabel("Attendee 3 Name").fill("Lucy Lovelace");
	await widget.getByLabel("Attendee 3 is Under 18").check();
	await widget.getByRole("button", { name: "Book" }).click();
	await page.waitForURL(/\/_events\/waiver\?ref=[0-9A-Z]{10}/);
	return new URL(page.url()).searchParams.get("ref") as string;
}

/** Signs the ceremony on screen (the waiver page's, or e-sign's `/sign/<token>`). */
async function signCeremony(page: Page, name: string) {
	await expect(page.getByTestId("signing-ceremony")).toHaveAttribute("data-state", "ready");
	await page.getByLabel("Type your full name to sign").fill(name);
	await page.getByLabel(/electronic records and an electronic signature/).check();
	await page.getByLabel(/I intend/).check();
	await page.getByRole("button", { name: "Sign document" }).click();
}

const row = (page: Page, name: string) => page.getByTestId("attendee-row").filter({ hasText: name });

async function invitations(request: APIRequestContext, to: string, atLeast: number) {
	for (let tick = 0; tick < 20; tick++) {
		const sent = (await mailbox(request, to)).filter((m) => /asks you to sign/.test(m.subject));
		if (sent.length >= atLeast) return sent;
		await runCron(request, "outbox-drain", "semics-esign");
	}
	return (await mailbox(request, to)).filter((m) => /asks you to sign/.test(m.subject));
}

async function violations(page: Page) {
	const results = await new AxeBuilder({ page }).include(".semics-attendee-list").withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
	return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("R95 the booking page lists Signed / Waiting; Sign now signs the waiting adult's waiver on the same device", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const who = { buyer: address("ada"), adult: address("charles") };
	const { context, page } = await visitor(browser, true);
	const ref = await bookParty(page, who);
	// The flow opens the buyer's waiver (for themselves and, as guardian, the child) and lands on the
	// booking: confirmed, with the emailed adult still to sign.
	await signCeremony(page, "Ada Lovelace");
	await page.waitForURL(new RegExp(`/booking\\?ref=${ref}&waiver=signed`));

	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	const list = page.getByTestId("attendee-list");
	await expect(list.getByTestId("attendee-row")).toHaveCount(3);
	await expect(row(page, "Ada Lovelace")).toHaveAttribute("data-signing", "signed");
	await expect(row(page, "Lucy Lovelace")).toHaveAttribute("data-signing", "signed");
	await expect(row(page, "Charles Babage")).toHaveAttribute("data-signing", "waiting");
	// Only waiting attendees can be signed; only the emailed adult can be invited again.
	await expect(list.getByTestId("attendee-sign-now")).toHaveCount(1);
	await expect(list.getByTestId("attendee-resend")).toHaveCount(1);
	await expect(row(page, "Charles Babage")).toContainText(who.adult);
	expect(await violations(page)).toEqual([]);
	await page.setViewportSize({ width: 320, height: 800 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
	expect(await violations(page)).toEqual([]);

	// Sign now: the adult signs their own waiver on the buyer's device; back on the same page.
	await row(page, "Charles Babage").getByTestId("attendee-sign-now").click();
	await page.waitForURL(/\/sign\/[A-Za-z0-9_-]+$/);
	await signCeremony(page, "Charles Babage");
	await page.waitForURL(new RegExp(`/booking\\?ref=${ref}`));
	await expect(row(page, "Charles Babage")).toHaveAttribute("data-signing", "signed");
	await expect(list.getByTestId("attendee-sign-now")).toHaveCount(0);
	await expect(page.getByTestId("attendee-edit")).toHaveCount(0);
	await expect(page.getByTestId("ticket-pass")).toHaveCount(3);
	await context.close();
});

test("R95 Resend emails the adult again; a misspelt email is corrected before the cutoff, refused after", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const who = { buyer: address("ada"), adult: address("charlse") };
	const { context, page } = await visitor(browser, true);
	const ref = await bookParty(page, who);
	await page.goto(`/booking?ref=${ref}`);
	expect(await invitations(request, who.adult, 1)).toHaveLength(1);

	await row(page, "Charles Babage").getByTestId("attendee-resend").click();
	await expect(page).toHaveURL(new RegExp(`/booking\\?ref=${ref}&attendees=resent`));
	await expect(page.getByTestId("booking-notice")).toBeVisible();
	expect(await invitations(request, who.adult, 2)).toHaveLength(2);

	// The buyer fixes the adult's name and address: the new address is invited, the old envelope voided.
	const fixed = address("charles");
	const edit = page.getByTestId("attendee-edit");
	await expect(edit).toBeVisible();
	await edit.getByLabel("Name").nth(1).fill("Charles Babbage");
	await edit.getByLabel("Email").nth(1).fill(fixed);
	await edit.getByTestId("attendee-save").click();
	await expect(page).toHaveURL(new RegExp(`/booking\\?ref=${ref}&attendees=saved`));
	await expect(row(page, "Charles Babbage")).toHaveAttribute("data-signing", "waiting");
	expect(await invitations(request, fixed, 1)).toHaveLength(1);

	// Past the cutoff (720 hours before a start ten days away): no edit form, and a stale post is refused.
	await saveSettings(request, { attendeeEditCutoffHours: 720 });
	try {
		const stale = await page.getByTestId("attendee-edit").evaluate((form) => (form as HTMLFormElement).outerHTML);
		await page.reload();
		await expect(page.getByTestId("attendee-edit")).toHaveCount(0);
		await expect(row(page, "Charles Babbage").getByTestId("attendee-sign-now")).toBeVisible();
		// The form as it was before the cutoff, posted again: the page refuses it.
		await page.evaluate((html) => {
			document.body.insertAdjacentHTML("beforeend", html);
			const form = document.body.lastElementChild as HTMLFormElement;
			(form.querySelector('input[name="name:2"]') as HTMLInputElement).value = "Charles Late";
			form.submit();
		}, stale);
		await expect(page).toHaveURL(new RegExp(`/booking\\?ref=${ref}&error=`));
		await expect(page.getByTestId("booking-notice")).toBeVisible();
		await expect(row(page, "Charles Babbage")).toHaveCount(1);
		await expect(row(page, "Charles Late")).toHaveCount(0);
	} finally {
		await saveSettings(request, { attendeeEditCutoffHours: 24 });
	}
	await context.close();
});

test("R95 no JavaScript: the list, Sign now and Resend are plain forms; the receipt comes back by reconcile", async ({
	browser,
	request,
}) => {
	await requirePro(request);
	const who = { buyer: address("ada"), adult: address("charles") };
	const { context, page } = await visitor(browser, false);
	const ref = await bookParty(page, who);
	await page.goto(`/booking?ref=${ref}`);
	await expect(page.getByTestId("attendee-row")).toHaveCount(3);
	await expect(page.locator('[data-signing="waiting"]')).toHaveCount(3);

	await row(page, "Charles Babage").getByTestId("attendee-resend").click();
	await expect(page).toHaveURL(new RegExp(`/booking\\?ref=${ref}&attendees=resent`));

	await row(page, "Ada Lovelace").getByTestId("attendee-sign-now").click();
	await page.waitForURL(/\/sign\/[A-Za-z0-9_-]+$/);
	await signCeremony(page, "Ada Lovelace");
	await page.waitForURL(new RegExp(`/booking\\?ref=${ref}`));
	// Without the page script the fragment's receipt is not posted: reloading reconciles with e-sign.
	await page.goto(`/booking?ref=${ref}`);
	await expect(row(page, "Ada Lovelace")).toHaveAttribute("data-signing", "signed");
	await expect(row(page, "Charles Babage")).toHaveAttribute("data-signing", "waiting");
	await context.close();
});
