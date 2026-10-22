import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

import { createAndSend, type Sent } from "./harness/esign-journey";

// T101 (EU-NFR-01, SU-NFR-03): the accessibility audit of every public page the Free plugins render.
// axe runs every WCAG 2.0/2.1/2.2 A and AA rule (the rules Lighthouse's accessibility score is made
// of) on each page, at desktop width and at 320 CSS px (WCAG 1.4.10 reflow); keyboard, focus,
// labels and live regions are checked by hand below, including the E-sign email-code step (T091).

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every axe violation of a WCAG A/AA rule, as `rule: targets` (empty when the page passes). */
async function violations(page: Page): Promise<string[]> {
	const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
	return results.violations.map(
		(v) => `${v.id} [${v.impact}]: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
	);
}

async function open(browser: Browser, options: { width?: number; js?: boolean; dark?: boolean } = {}) {
	const context = await browser.newContext({
		viewport: { width: options.width ?? 1280, height: 800 },
		javaScriptEnabled: options.js ?? true,
		colorScheme: options.dark ? "dark" : "light",
	});
	return { context, page: await context.newPage() };
}

/** The envelope asks for an email code before signing (what E-sign Pro stamps at send, T091). */
function requireOtp(sent: Sent) {
	const db = new DatabaseSync(resolve(root, "data.db"));
	try {
		const where = `WHERE plugin_id = 'semics-esign' AND collection = 'envelopes' AND id = ?`;
		const row = db.prepare(`SELECT data FROM _plugin_storage ${where}`).get(sent.envelopeId) as { data: string };
		const data = { ...(JSON.parse(row.data) as Record<string, unknown>), otp: true };
		db.prepare(`UPDATE _plugin_storage SET data = ? ${where}`).run(JSON.stringify(data), sent.envelopeId);
	} finally {
		db.close();
	}
}

/** Presses `key` and waits for the form post it sends and the page that answers it. */
async function submitWith(page: Page, key: string) {
	const answered = page.waitForResponse((r) => r.request().method() === "POST" && r.request().isNavigationRequest());
	await page.keyboard.press(key);
	await answered;
	await page.waitForLoadState();
}

let signing: Sent;
let otpSigning: Sent;

test.beforeAll(async ({ request }) => {
	signing = await createAndSend(request, "Accessibility audit agreement");
	otpSigning = await createAndSend(request, "Accessibility audit code agreement");
	requireOtp(otpSigning);
});

const PAGES = [
	"/",
	"/events",
	"/events/london-meetup",
	"/events/nyc-workshop",
	"/events/london-meetup?booking_error=BAD_REQUEST&booking_fields=tickets,name,email&booking_event=01M5J0WMVJRCT4V7GQBNC9NEC6",
	"/whats-on",
	"/photo-consent",
	"/booking",
	"/booking?ref=ABCDEFGHJK",
	"/booking?ref=ABCDEFGHJK&k=one-time-code",
	"/booking?ref=ABCDEFGHJK&k=one-time-code&offer=1",
	"/booking?error=HOLD_EXPIRED",
	"/verify",
	"/signed/" + "x".repeat(43),
	"/sign/" + "x".repeat(43),
	"/_events/sign",
	"/_events/templates",
	"/_events/check-in",
	"/e2e/widgets",
	"/e2e/lists?view=live",
	"/e2e/lists?view=empty",
	"/e2e/lists?view=card&theme=dark",
	"/e2e/ceremony",
	"/e2e/ceremony?state=signed",
	"/e2e/ceremony?state=closed",
	"/e2e/ceremony?state=otp",
	"/e2e/ceremony?state=otp&otp=sent",
	"/e2e/ceremony?state=otp&otp=OTP_LOCKED",
	"/e2e/ceremony?state=fix&fields=typedName,consent,field.company",
	"/e2e/payment?state=awaiting_payment",
	"/e2e/payment?state=confirmed",
	"/e2e/payment?state=refunded_unavailable",
	"/e2e/promo",
	"/e2e/questions",
	"/e2e/waiver?slug=london-meetup",
];

test("EU-NFR-01 SU-NFR-03 every public page passes the WCAG 2.2 AA axe rules, at desktop width and at 320 px", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const failures: string[] = [];
	for (const width of [1280, 320]) {
		const { context, page } = await open(browser, { width });
		for (const path of [...PAGES, `/sign/${signing.token}`, `/sign/${otpSigning.token}`]) {
			await page.goto(path);
			for (const v of await violations(page)) failures.push(`${path} @${width}px ${v}`);
		}
		await context.close();
	}
	expect(failures).toEqual([]);
});

test("EU-NFR-01 SU-NFR-03 the plugin pages reflow at 320 px without scrolling sideways (WCAG 1.4.10)", async ({ browser }) => {
	const { context, page } = await open(browser, { width: 320 });
	const wide: string[] = [];
	for (const path of ["/events/london-meetup", "/e2e/widgets", "/e2e/questions", "/e2e/payment", "/booking", "/verify", `/sign/${signing.token}`]) {
		await page.goto(path);
		// Let late content settle (the Turnstile frame, the payment poll's first look).
		await page.waitForTimeout(1500);
		const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		if (over > 0) wide.push(`${path} scrolls ${over}px sideways`);
	}
	await context.close();
	expect(wide).toEqual([]);
});

/** Tabs through the page and returns each plugin control that has no visible focus indicator. */
async function focusWithoutRing(page: Page, scope: string): Promise<{ stops: number; bare: string[] }> {
	const bare: string[] = [];
	let stops = 0;
	let first = "";
	for (let i = 0; i < 80; i++) {
		await page.keyboard.press("Tab");
		const seen = await page.evaluate((scope) => {
			const el = document.activeElement as HTMLElement | null;
			if (!el || el === document.body || !el.closest(scope)) return el && el !== document.body ? { skip: true } : null;
			const cs = getComputedStyle(el);
			const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1) || cs.boxShadow !== "none";
			const name = `${el.tagName.toLowerCase()}#${el.id || el.getAttribute("name") || el.textContent?.trim().slice(0, 24)}`;
			return { skip: false, name, ring };
		}, scope);
		if (!seen) break;
		if (seen.skip || !("name" in seen)) continue;
		if (seen.name === first) break;
		first ||= seen.name;
		stops += 1;
		if (!seen.ring) bare.push(seen.name);
	}
	return { stops, bare };
}

test("EU-NFR-01 SU-NFR-03 every plugin control is reached by Tab and shows a focus indicator (WCAG 2.1.1, 2.4.7)", async ({
	browser,
}) => {
	const { context, page } = await open(browser);
	const report: string[] = [];
	for (const [path, scope, min] of [
		// Earlier specs may sell out one of its ticket types (a disabled input is skipped by Tab).
		["/events/london-meetup", ".semics-events", 4],
		["/e2e/questions", ".semics-events", 6],
		["/e2e/payment?state=awaiting_payment", ".semics-events", 2],
		["/whats-on", ".semics-events", 3],
		["/verify", ".semics-esign", 2],
		[`/sign/${signing.token}`, ".semics-esign", 6],
		[`/sign/${otpSigning.token}`, ".semics-esign", 3],
	] as const) {
		await page.goto(path);
		const { stops, bare } = await focusWithoutRing(page, scope);
		if (stops < min) report.push(`${path}: only ${stops} controls reached by Tab`);
		for (const name of bare) report.push(`${path}: ${name} has no focus indicator`);
	}
	await context.close();
	expect(report).toEqual([]);
});

test("SU-NFR-03 the email-code step works by keyboard alone, explains the code, and never puts it in a URL (T091)", async ({
	browser,
}) => {
	const { context, page } = await open(browser, { js: false });
	const posts: string[] = [];
	page.on("request", (r) => {
		if (r.method() === "POST") posts.push(r.postData() ?? "");
	});
	await page.goto(`/sign/${otpSigning.token}`);
	const step = page.getByTestId("sign-otp");
	await expect(step).toBeVisible();
	await expect(step).toHaveAccessibleName("Email code");
	await expect(page.locator("[data-esign-sign-form]")).toHaveCount(0);
	const code = page.getByLabel("Code", { exact: true });
	await expect(code).toHaveAttribute("autocomplete", "one-time-code");
	await expect(code).toHaveAccessibleDescription(/6-digit code/);

	// Keyboard only: Tab to "Email me a code" and press Enter.
	const send = page.getByRole("button", { name: "Email me a code" });
	for (let i = 0; i < 30 && !(await send.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
	await expect(send).toBeFocused();
	await submitWith(page, "Enter");
	// The Free core cannot send codes (E-sign Pro's routes), so the step says so, next to the code box.
	const alert = step.getByRole("alert");
	await expect(alert).toBeVisible();
	await expect(page.getByTestId("sign-otp").getByLabel("Code", { exact: true })).toHaveAccessibleDescription(
		new RegExp((await alert.textContent())?.trim() ?? "missing"),
	);
	// The page comes back at the code step, so the next Tab goes to its controls, not the top of the page.
	expect(new URL(page.url()).hash).toBe("#esign-otp");

	// Type a code and submit it with Enter: the code goes in the POST body only.
	await page.getByLabel("Code", { exact: true }).focus();
	await page.keyboard.type("123456");
	await submitWith(page, "Enter");
	expect(posts.some((body) => body.includes("code=123456"))).toBe(true);
	expect(page.url()).not.toContain("123456");
	expect(new URL(page.url()).search).toBe("");
	await expect(page.getByTestId("sign-otp").getByRole("alert")).toBeVisible();
	await context.close();
});

test("SU-NFR-03 wrong, expired and locked codes are announced at the code box and mark it invalid (T091)", async ({ page }) => {
	for (const code of ["OTP_INVALID", "OTP_EXPIRED", "OTP_LOCKED"]) {
		await page.goto(`/e2e/ceremony?state=otp&otp=${code}`);
		const step = page.getByTestId("sign-otp");
		const alert = step.getByRole("alert");
		await expect(alert).toHaveAttribute("data-code", code);
		const box = step.getByLabel("Code", { exact: true });
		await expect(box).toHaveAttribute("aria-invalid", "true");
		await expect(box).toHaveAccessibleDescription(new RegExp(`6-digit code.*${(await alert.textContent())?.trim()}`));
		// Shown once: not also at the top of the page.
		await expect(page.getByRole("alert")).toHaveCount(1);
		expect(await violations(page)).toEqual([]);
	}
	for (const code of ["OTP_WAIT", "OTP_SEND_FAILED"]) {
		await page.goto(`/e2e/ceremony?state=otp&otp=${code}`);
		await expect(page.getByTestId("sign-otp").getByRole("alert")).toHaveAttribute("data-code", code);
		await expect(page.getByTestId("sign-otp").getByLabel("Code", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
	}
	await page.goto("/e2e/ceremony?state=otp&otp=sent");
	await expect(page.getByTestId("sign-otp").getByRole("status")).toHaveText(/We emailed you a code/);
	for (const form of await page.getByTestId("sign-otp").locator("form").all()) {
		expect(await form.getAttribute("method")).toBe("post");
		expect(await form.getAttribute("action")).toBe("/e2e/ceremony#esign-otp");
	}
});

test("SU-NFR-03 a refused sign links each field to fix with the message that explains it (WCAG 3.3.1)", async ({ page }) => {
	await page.goto("/e2e/ceremony?state=fix&fields=typedName,consent,field.company");
	const message = (await page.getByTestId("sign-error").textContent())?.trim() ?? "missing";
	for (const control of [
		page.getByLabel("Type your full name to sign"),
		page.getByLabel(/I agree to use electronic records/),
		page.getByLabel(/^Company/),
	]) {
		await expect(control).toHaveAttribute("aria-invalid", "true");
		await expect(control).toHaveAccessibleDescription(message);
	}
	await expect(page.getByLabel(/I intend the signature/)).not.toHaveAttribute("aria-invalid", "true");
});
