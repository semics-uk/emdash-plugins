import { expect, test } from "@playwright/test";

import { address, book, visitor } from "./support";

// T111 staging smoke: the site, the sandboxed core behind it and one real booking, on whatever runs
// at the target (Cloudflare Worker Loader on staging, workerd locally).

test("the site renders its pages", async ({ page }) => {
	const home = await page.goto("/");
	expect(home?.status()).toBe(200);
	await page.goto("/whats-on");
	await expect(page.getByRole("heading", { name: /London meetup/i }).first()).toBeVisible();
});

test("S2: the page calls the sandboxed core's public route in-process", async ({ page }) => {
	await page.goto("/spike/s2");
	const result = page.getByTestId("s2-result");
	await expect(result).toHaveAttribute("data-state", "ok");
	await expect(result).toHaveAttribute("data-via", "in-process");
	await expect(page.getByTestId("s2-echo")).toContainText("London");
});

test("a visitor books a free ticket without JavaScript", async ({ browser }) => {
	const v = await visitor(browser);
	const ref = await book(v.page, "london-meetup", /General admission/, "Grace Hopper", address("smoke"));
	expect(ref).toMatch(/^[0-9A-Z]{10}$/);
	await expect(v.page.getByTestId("ticket-code").first()).toHaveText(/^[A-Za-z0-9_-]{20,}$/);
	await v.context.close();
});
