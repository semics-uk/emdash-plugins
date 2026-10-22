import { expect, test } from "@playwright/test";

// Spike S2 (EU-FR-02): SSR components reach the sandboxed core's public routes in-process.
// T054 pointed the page at the first real public route, `public/events` (T046).

test("EU-FR-02 a page server-renders data returned by the sandboxed public/events route", async ({
	browser,
}) => {
	// No JavaScript: whatever is on the page was rendered on the server.
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	const response = await page.goto("/spike/s2");
	expect(response?.status()).toBe(200);

	const result = page.getByTestId("s2-result");
	await expect(result).toHaveAttribute("data-state", "ok");
	await expect(result).toHaveAttribute("data-via", "in-process");
	await expect(page.getByTestId("s2-plugin-id")).toHaveText("semics-events");
	await expect(page.getByTestId("s2-method")).toHaveText("GET");
	await expect(page.getByTestId("s2-echo")).toHaveText("London Community Meetup,New York Design Workshop,Sydney Summit");
	await context.close();
});

test("EU-FR-02 the same page renders a defined error state when the plugin is not enabled", async ({
	page,
}) => {
	const response = await page.goto("/spike/s2?plugin=semics-events-disabled");
	expect(response?.status()).toBe(200);

	const result = page.getByTestId("s2-result");
	await expect(result).toHaveAttribute("data-state", "error");
	await expect(page.getByTestId("s2-error-code")).toHaveText("NOT_FOUND");
	await expect(page.getByRole("alert")).toContainText("Events are unavailable");
});
