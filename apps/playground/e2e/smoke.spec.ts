import { expect, test } from "@playwright/test";

test("home page responds 200", async ({ page }) => {
	const response = await page.goto("/");
	expect(response?.status()).toBe(200);
});

test("an event entry page renders its title and venue", async ({ page }) => {
	const response = await page.goto("/events/london-meetup");
	expect(response?.status()).toBe(200);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("London Community Meetup");
	await expect(page.getByTestId("event-venue")).toHaveText("The Old Library, London");
	await expect(page.getByTestId("event-timezone")).toHaveText("Europe/London");
});

test("an unknown event slug does not render an event", async ({ page }) => {
	const response = await page.goto("/events/does-not-exist");
	expect(response?.status()).toBe(404);
});
