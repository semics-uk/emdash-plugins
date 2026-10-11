import { expect, test } from "@playwright/test";

// Spike S2 (EU-FR-02): SSR components reach the sandboxed core's public routes in-process.
// The temporary public/probe route was removed after the spike (findings in BUILD-PLAN §7), so the
// success case is skipped. T009 should repoint it at the first real public route.

test("EU-FR-02 a page server-renders data returned by the sandboxed public/probe route", async ({
	browser,
}) => {
	test.skip(true, "public/probe removed after Spike S2 (T004); repoint at the first real public route in T009");
	// No JavaScript: whatever is on the page was rendered on the server.
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	const response = await page.goto("/spike/s2");
	expect(response?.status()).toBe(200);

	const result = page.getByTestId("s2-result");
	await expect(result).toHaveAttribute("data-state", "ok");
	await expect(result).toHaveAttribute("data-via", "in-process");
	await expect(page.getByTestId("s2-plugin-id")).toHaveText("semics-events");
	await expect(page.getByTestId("s2-method")).toHaveText("POST");
	await expect(page.getByTestId("s2-echo")).toHaveText('{"ping":"s2"}');
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
