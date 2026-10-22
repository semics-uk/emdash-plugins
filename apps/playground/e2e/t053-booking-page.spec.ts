import { expect, test } from "@playwright/test";

// T053 (EU-FR-05, EU-FR-06): the injected /booking page and the no-JS checkout endpoint.

test("EU-FR-06 /booking sends Referrer-Policy: no-referrer and is not cached", async ({ request }) => {
	const response = await request.get("/booking");
	expect(response.status()).toBe(200);
	expect(response.headers()["referrer-policy"]).toBe("no-referrer");
	expect(response.headers()["cache-control"]).toContain("no-store");
});

test("EU-FR-05 a plain form post to /_events/checkout redirects to the booking page", async ({ request }) => {
	const response = await request.post("/_events/checkout", {
		form: { eventId: "missing", "qty:general": "1", name: "Ada", email: "ada@example.com" },
		maxRedirects: 0,
	});
	expect(response.status()).toBe(303);
	const location = response.headers().location ?? "";
	expect(new URL(location, "http://x").pathname).toBe("/booking");
	expect(location).toContain("error=");
});

// T057: EmDash 1.2 turns Astro's `security.checkOrigin` off, so the forms check for themselves.
test("T057 cross-site posts to the checkout and the booking page's forms get 403", async ({ request }) => {
	for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
		const checkout = await request.post("/_events/checkout", {
			form: { eventId: "missing", "qty:general": "1", name: "Ada", email: "ada@example.com" },
			headers,
			maxRedirects: 0,
		});
		expect(checkout.status()).toBe(403);
		const cancel = await request.post("/booking?ref=ABCDEFGHJK", {
			form: { intent: "cancel" },
			headers,
			maxRedirects: 0,
		});
		expect(cancel.status()).toBe(403);
		const redeem = await request.post("/booking?ref=ABCDEFGHJK", {
			form: { intent: "redeem", k: "x".repeat(43) },
			headers,
			maxRedirects: 0,
		});
		expect(redeem.status()).toBe(403);
	}
});

test("EU-FR-05 the no-JS redirect lands on a rendered booking page with a defined error", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto("/booking?error=SOLD_OUT");
	await expect(page.getByRole("alert")).toContainText("sold out");
	await context.close();
});

test("EU-FR-06 an unknown booking ref shows a not-found state without leaking a token", async ({ page }) => {
	const urls: string[] = [];
	page.on("request", (r) => urls.push(r.url()));
	await page.goto("/booking?ref=ABCDEFGHJK");
	await expect(page.getByTestId("booking-missing")).toBeVisible();
	expect(urls.filter((u) => /token/i.test(u))).toEqual([]);
});
