import { expect, test } from "@playwright/test";

// T029 (SU-FR-01, SU-FR-02): the injected /sign/[token] and /verify pages.

const TOKEN = "T".repeat(43);

test("SU-FR-01 /sign/<token> renders the ceremony shell with a defined state for an unknown link", async ({ page }) => {
	const urls: string[] = [];
	page.on("request", (r) => urls.push(r.url()));
	const response = await page.goto(`/sign/${TOKEN}`);
	expect(response?.status()).toBeLessThan(500);
	await expect(page.getByTestId("sign-page")).toBeVisible();
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByTestId("sign-error")).toBeVisible();
	// The token is the page path only; no other request carries it.
	expect(urls.filter((u) => u.includes(TOKEN) && new URL(u).pathname !== `/sign/${TOKEN}`)).toEqual([]);
});

test("SU-FR-01 EU-NFR-06 /sign/<token> sends Referrer-Policy: no-referrer and is never cached", async ({ request }) => {
	const response = await request.get(`/sign/${TOKEN}`);
	expect(response.headers()["referrer-policy"]).toBe("no-referrer");
	expect(response.headers()["cache-control"]).toContain("no-store");
});

test("SU-FR-02 /verify sends the same headers and works without JavaScript", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	const response = await page.goto("/verify");
	expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
	await page.getByLabel(/sha-256/i).fill("0".repeat(64));
	await page.getByRole("button", { name: /verify/i }).click();
	await expect(page.getByTestId("verify-result")).toContainText(/no signed document/i);
	await context.close();
});
