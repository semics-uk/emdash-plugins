import { expect, type Page, test } from "@playwright/test";

// T178: the Events setup check (field mapping, encryption key, Turnstile) runs on the site at
// `/_events/setup`, not in the sandboxed backend. Administrators only: the host's own plugin-settings read
// checks the session. No secret value reaches the browser, only whether each one is readable.

test.describe.configure({ mode: "serial" });

/** Signs the browser context in as the seeded admin through the real magic-link flow (mail capture). */
async function signIn(page: Page, baseURL: string) {
	const origin = { origin: baseURL, "x-forwarded-for": "198.51.100.178" };
	const sent = await page.request.post("/_emdash/api/auth/magic-link/send", {
		data: { email: "admin@example.com" },
		headers: origin,
	});
	expect(sent.ok(), await sent.text()).toBe(true);
	let token: string | undefined;
	for (let i = 0; i < 20 && !token; i++) {
		const { messages } = (await (await page.request.get("/e2e/mail?to=admin%40example.com")).json()) as {
			messages: Array<{ text?: string; html?: string }>;
		};
		const last = messages.at(-1);
		token = /[?&]token=([A-Za-z0-9_-]+)/.exec(`${last?.text ?? ""} ${last?.html ?? ""}`)?.[1];
		if (!token) await page.waitForTimeout(250);
	}
	expect(token, "magic link token").toBeDefined();
	const verified = await page.request.post("/_emdash/api/auth/magic-link/verify", { data: { token }, headers: origin });
	expect(verified.ok(), await verified.text()).toBe(true);
}

test("T178 the setup check is refused signed out and shows the mapping to an administrator", async ({
	page,
	baseURL,
}) => {
	const anonymous = await page.goto("/_events/setup");
	expect(anonymous?.status()).toBe(403);
	await expect(page.getByTestId("setup-forbidden")).toBeVisible();
	await expect(page.getByTestId("setup-fields")).toHaveCount(0);

	await signIn(page, baseURL as string);
	const res = await page.goto("/_events/setup");
	expect(res?.status()).toBe(200);
	await expect(page.getByTestId("setup-page")).toHaveAttribute("data-state", "ok");
	const fields = page.getByTestId("setup-fields");
	await expect(fields).toContainText("Events collection");
	await expect(fields).toContainText("Start field");
	await expect(page.getByRole("link", { name: "Open plugin settings" })).toHaveAttribute(
		"href",
		"/_emdash/admin/plugins-manager/semics-events/settings",
	);
	expect(res?.headers()["cache-control"]).toContain("no-store");
});
