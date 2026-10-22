import { expect, test } from "@playwright/test";

// T093 (ES-FR-18, SU-FR-12): the `esign-request` Portable Text block on a page. The playground runs the Free cores
// only, where `public/self-serve/start` is the NOT_FOUND stub (self-serve is E-sign Pro), so the block must render
// its unavailable state: a short note, no form, nothing that posts. The Pro behaviour is tested in the Pro repo.

test("SU-FR-12 on Free the esign-request block renders a note and no form, with JavaScript off", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	const response = await page.goto("/photo-consent");
	expect(response?.status()).toBe(200);
	const block = page.getByTestId("esign-request");
	await expect(block.getByRole("heading", { level: 2 })).toHaveText("Photo consent form");
	await expect(block.getByTestId("esign-request-unavailable")).toHaveText("This form is not available right now.");
	await expect(block.getByTestId("esign-request-form")).toHaveCount(0);
	await expect(page.locator("form[action='/_esign/start']")).toHaveCount(0);
	await context.close();
});

test("ES-FR-18 the injected /_esign/start endpoint refuses a cross-site post and a bare post with no template", async ({
	request,
}) => {
	const cross = await request.post("/_esign/start", {
		headers: { "sec-fetch-site": "cross-site" },
		form: { templateId: "photo-consent-template", name: "x", email: "x@example.com" },
	});
	expect(cross.status()).toBe(403);
	const bare = await request.post("/_esign/start", { headers: { "sec-fetch-site": "same-origin" }, form: {} });
	expect(bare.status()).toBe(400);
});

test("ES-FR-18 a same-site post on Free redirects back with the refusal, never a link", async ({ request }) => {
	const res = await request.post("/_esign/start", {
		headers: { "sec-fetch-site": "same-origin" },
		form: { templateId: "photo-consent-template", returnTo: "/photo-consent", name: "Ada", email: "ada@example.com" },
		maxRedirects: 0,
	});
	expect(res.status()).toBe(303);
	const location = res.headers().location ?? "";
	expect(location).toContain("/photo-consent?esign_start=NOT_FOUND&esign_t=photo-consent-template");
	expect(location).not.toContain("ada@example.com");
});
