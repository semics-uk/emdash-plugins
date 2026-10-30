import { type Browser, expect, test } from "@playwright/test";

// T054 (EU-FR-03, EU-US-4): the event list, the card and the Portable Text blocks, server-rendered
// from `public/events` with no client JavaScript. The seeded site has three upcoming events on sale
// (London, New York, Sydney; e2e/harness/fixtures.mjs) and a past one that is not listed.

async function noJs(browser: Browser) {
	const context = await browser.newContext({ javaScriptEnabled: false });
	return { context, page: await context.newPage() };
}

test("EU-FR-03 the list shows each upcoming event in its own time zone, from public/events", async ({ browser }) => {
	const { context, page } = await noJs(browser);
	await page.goto("/e2e/lists?view=live");
	const list = page.getByTestId("event-list");
	await expect(list).toHaveAttribute("data-state", "ok");
	const cards = list.getByTestId("event-card");
	await expect(cards).toHaveCount(3);
	// Soonest first; the past gala is not listed.
	await expect(cards.nth(0).getByRole("heading")).toHaveText("London Community Meetup");
	await expect(cards.nth(0).getByTestId("event-when")).toContainText("18:30");
	await expect(cards.nth(0).getByTestId("event-when")).toContainText("GMT");
	await expect(cards.nth(1).getByTestId("event-when")).toContainText("10:00"); // 14:00 UTC in New York (EDT)
	await expect(cards.nth(2).getByTestId("event-when")).toContainText("09:00"); // 22:00 UTC in Sydney (AEDT, next day)
	await expect(cards.nth(2).getByTestId("event-when")).toContainText("6 Nov 2030");
	await expect(cards.nth(0).locator("time")).toHaveAttribute("datetime", "2030-03-14T18:30:00.000Z");
	await expect(list.getByText("Winter Gala")).toHaveCount(0);
	await context.close();
});

test("EU-FR-03 an empty list renders the empty state", async ({ browser }) => {
	const { context, page } = await noJs(browser);
	await page.goto("/e2e/lists?view=empty");
	const list = page.getByTestId("event-list");
	await expect(list).toHaveAttribute("data-state", "empty");
	await expect(list.getByTestId("event-list-empty")).toHaveText("No upcoming events right now.");
	await expect(list.getByTestId("event-card")).toHaveCount(0);
	await context.close();
});

test("EU-FR-03 a core that is not enabled renders a defined error state, not a broken page", async ({ page }) => {
	const response = await page.goto("/e2e/lists?view=live&plugin=semics-events-disabled");
	expect(response?.status()).toBe(200);
	await expect(page.getByTestId("event-list")).toHaveAttribute("data-state", "error");
	await expect(page.getByTestId("event-list-error")).toContainText("Events are unavailable");
});

test("EU-US-4 the events-booking block on a page renders the booking widget and books end to end", async ({ browser }) => {
	const { context, page } = await noJs(browser);
	await page.goto("/whats-on");
	const widget = page.getByTestId("booking-widget");
	await expect(widget.getByRole("heading", { name: "Book the London meetup" })).toBeVisible();
	await page.getByLabel(/General admission/).fill("1");
	await page.getByLabel("Your name").fill("Grace Hopper");
	await page.getByLabel("Email").fill("grace@example.com");
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(/\/booking\?ref=[0-9A-Z]{10}$/);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await context.close();
});

test("EU-FR-03 the card looks right in two themes", async ({ page }) => {
	await page.setViewportSize({ width: 420, height: 600 });
	for (const theme of ["light", "dark"]) {
		await page.goto(`/e2e/lists?view=card&theme=${theme}`);
		const card = page.getByTestId("event-card");
		// Human-readable assertion beside the snapshot.
		await expect(card.getByRole("heading")).toHaveText("London Community Meetup");
		await expect(card.getByTestId("event-when")).toContainText("Thu, 14 Mar 2030");
		// The e2e page fixes the card's box (T134), so a machine whose system font is a few pixels shorter
		// compares the same size of image; the pixel tolerance covers the glyphs.
		expect(await card.evaluate((e) => e.getBoundingClientRect().height)).toBe(128);
		await expect(card).toHaveScreenshot(`event-card-${theme}.png`, { maxDiffPixelRatio: 0.03 });
	}
});
