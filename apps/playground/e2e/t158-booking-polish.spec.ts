import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

// T158 (LMSC staging on rc.7): Turnstile's size follows the room the form has and its theme is light; hovering a
// day or time is lighter than choosing it; the widget takes its host column's width (or `--events-widget-max`);
// every card on the confirmed page has the same edges; the 43-character check-in code no longer sprawls.
// `T158_SHOTS=1` also writes the screenshots to tasks/evidence/T158/.

const SHOTS = resolve(process.cwd(), "../../tasks/evidence/T158");
const MOBILE = { width: 375, height: 812 };
const NARROW = { width: 320, height: 720 };
const DESKTOP = { width: 1280, height: 900 };
const WIDE = { width: 1568, height: 1000 };
const VIEW = "/e2e/booking-view";
const WIDGETS = [
	{ name: "events", path: "/e2e/widgets", widget: "booking-widget" },
	{ name: "waiver", path: "/e2e/waiver-picker?turnstile=1", widget: "booking-with-waiver" },
] as const;
const CODE = "q3M8vXbT1kR0wZ9pLc2YhN5sGd7uJf4aEo6iKyB_x-Q";

async function shot(page: Page, name: string, fullPage = true) {
	if (process.env.T158_SHOTS !== "1") return;
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage });
}

// Turnstile stays offline: a stand-in api.js draws a box the size Turnstile would (300x65, or 150x140 compact),
// dark when the widget asks for dark or leaves it to the system (Turnstile's "auto").
const TURNSTILE_STUB = `document.querySelectorAll(".cf-turnstile").forEach(function (el) {
	var compact = el.getAttribute("data-size") === "compact";
	var light = el.getAttribute("data-theme") === "light";
	var box = document.createElement("div");
	box.setAttribute("data-turnstile-stub", "");
	box.style.cssText = "width:" + (compact ? 150 : 300) + "px;height:" + (compact ? 140 : 65) + "px;border:1px solid #888;background:" + (light ? "#fafafa" : "#232323");
	el.appendChild(box);
});`;

async function open(browser: Browser, path: string, viewport: { width: number; height: number }) {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	await page.route("https://challenges.cloudflare.com/**", (route) =>
		route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB }),
	);
	await page.goto(path);
	return { context, page };
}

const noSideways = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const box = async (l: Locator) => {
	const b = await l.boundingBox();
	if (!b) throw new Error("no box");
	return b;
};

test("T158 Turnstile takes its full size when the form has room, compact only on a narrow screen, and is light", async ({ browser }) => {
	for (const { name, path, widget: id } of WIDGETS) {
		const desktop = await open(browser, path, DESKTOP);
		const widget = desktop.page.getByTestId(id).first();
		const turnstile = widget.locator("form .cf-turnstile").first();
		await expect(turnstile.locator("[data-turnstile-stub]")).toHaveCount(1);
		await expect(turnstile, name).not.toHaveAttribute("data-size", "compact");
		await expect(turnstile, name).toHaveAttribute("data-theme", "light");
		expect((await box(turnstile.locator("[data-turnstile-stub]"))).height, name).toBeLessThan(100);
		await shot(desktop.page, `widget-${name}-desktop`);
		await desktop.context.close();

		for (const [label, viewport] of [["320", NARROW], ["375", MOBILE]] as const) {
			const narrow = await open(browser, path, viewport);
			const t = narrow.page.getByTestId(id).first().locator("form .cf-turnstile").first();
			await expect(t.locator("[data-turnstile-stub]")).toHaveCount(1);
			const room = await t.evaluate((el) => (el.closest("form") as HTMLElement).clientWidth);
			// Compact exactly when the form is narrower than Turnstile's 300px.
			if (room < 300) await expect(t, `${name} ${label}`).toHaveAttribute("data-size", "compact");
			else await expect(t, `${name} ${label}`).not.toHaveAttribute("data-size", "compact");
			await expect(t).toHaveAttribute("data-theme", "light");
			expect(await noSideways(narrow.page), `${name} ${label}`).toBeLessThanOrEqual(0);
			if (label === "375") await shot(narrow.page, `widget-${name}-375`);
			await narrow.context.close();
		}
	}
});

test("T158 the size is chosen from the room the form has even when the box is measured before layout", async ({ browser }) => {
	// The widget is out of the layout while the page parses (as in a host that reveals it later): the box has no
	// width when the inline script runs, which used to pick compact on a desktop.
	for (const { name, path, widget: id } of WIDGETS) {
		const context = await browser.newContext({ viewport: DESKTOP });
		const page = await context.newPage();
		await page.route("https://challenges.cloudflare.com/**", (route) =>
			route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB }),
		);
		await page.addInitScript(() => {
			const hide = new MutationObserver(() => {
				const host = document.querySelector<HTMLElement>("[data-testid=host-column]");
				if (host && !host.dataset.t158) {
					host.dataset.t158 = "1";
					host.style.display = "none";
					document.addEventListener("DOMContentLoaded", () => {
						host.style.display = "";
					});
				}
			});
			hide.observe(document, { childList: true, subtree: true });
		});
		await page.goto(path);
		const turnstile = page.getByTestId(id).first().locator("form .cf-turnstile").first();
		await expect(turnstile.locator("[data-turnstile-stub]")).toHaveCount(1);
		await expect(turnstile, name).not.toHaveAttribute("data-size", "compact");
		await context.close();
	}
});

test("T158 hovering a day or a time is lighter than choosing it", async ({ browser }) => {
	for (const path of ["/e2e/picker", "/e2e/waiver-picker"]) {
		const context = await browser.newContext({ viewport: DESKTOP });
		const page = await context.newPage();
		await page.goto(path);
		const widget = page.locator(".semics-events").first();
		const days = widget.locator("button[data-day]:not(.semics-day-full)");
		await days.nth(0).click();
		const times = widget.locator("[data-times]:visible").getByRole("radio");
		await times.nth(0).click();
		const look = (l: Locator) =>
			l.evaluate((el) => {
				const s = getComputedStyle(el);
				return { bg: s.backgroundColor, fg: s.color, shadow: s.boxShadow };
			});
		await page.mouse.move(0, 0);
		const chosenDay = await look(days.nth(0));
		const chosenTime = await look(times.nth(0));
		const restDay = await look(days.nth(1));
		await days.nth(1).hover();
		const hoverDay = await look(days.nth(1));
		await times.nth(1).hover();
		const hoverTime = await look(times.nth(1));
		await shot(page, `hover-${path.includes("waiver") ? "waiver" : "events"}`, false);
		for (const [hover, chosen, what] of [
			[hoverDay, chosenDay, "day"],
			[hoverTime, chosenTime, "time"],
		] as const) {
			expect(hover.bg, `${path} ${what}`).not.toBe(chosen.bg);
			expect(hover.fg, `${path} ${what}`).not.toBe(chosen.fg);
		}
		// Hover still shows something: a tint and a ring.
		expect(hoverDay.bg).not.toBe(restDay.bg);
		expect(hoverDay.shadow).not.toBe("none");
		await context.close();
	}
});

test("T158 the widget takes its host column's width, or --events-widget-max", async ({ browser }) => {
	for (const { name, path, widget: id } of WIDGETS) {
		const sep = path.includes("?") ? "&" : "?";
		const wide = await open(browser, `${path}${sep}host=wide`, WIDE);
		const column = await box(wide.page.getByTestId("host-column"));
		const widget = await box(wide.page.getByTestId(id).first());
		expect(column.width).toBeGreaterThan(900);
		expect(Math.abs(widget.width - column.width), name).toBeLessThanOrEqual(1);
		await shot(wide.page, `widget-${name}-wide-host`);
		await wide.context.close();

		const capped = await open(browser, `${path}${sep}host=capped`, WIDE);
		expect(Math.round((await box(capped.page.getByTestId(id).first())).width), name).toBe(480);
		await capped.context.close();
	}
});

test("T158 every card on the confirmed page has the same edges, width and look", async ({ browser }) => {
	for (const [label, viewport] of [["desktop", WIDE], ["375", MOBILE]] as const) {
		const { context, page } = await open(browser, `${VIEW}?sections=all`, viewport);
		await expect(page.getByTestId("payment-return")).toContainText("Payment received");
		await expect(page.getByTestId("attendee-list")).toBeVisible();
		const cards = await page.locator("main > section").evaluateAll((els) =>
			els.map((el) => {
				const r = el.getBoundingClientRect();
				const s = getComputedStyle(el);
				return {
					id: el.getAttribute("data-testid") ?? el.getAttribute("aria-labelledby"),
					left: Math.round(r.left),
					right: Math.round(r.right),
					border: `${s.borderTopWidth} ${s.borderTopColor}`,
					radius: s.borderTopLeftRadius,
					shadow: s.boxShadow,
					padding: s.paddingInlineStart,
				};
			}),
		);
		expect(cards.length).toBe(4);
		const [first, ...rest] = cards;
		for (const card of rest) expect({ ...card, id: "" }, `${label} ${card.id}`).toEqual({ ...first, id: "" });
		expect(await noSideways(page)).toBeLessThanOrEqual(0);
		await shot(page, `confirmed-${label}`);
		await context.close();
	}
});

test("T158 a pass with a QR keeps its code out of the way; the full code stays readable and unchanged", async ({ browser }) => {
	for (const [label, viewport] of [["desktop", DESKTOP], ["375", MOBILE]] as const) {
		const { context, page } = await open(browser, VIEW, viewport);
		const pass = page.getByTestId("ticket-pass").first();
		await expect(pass.getByTestId("ticket-qr")).toBeVisible();
		// No 43-character string on the face of the pass.
		await expect(pass.getByTestId("ticket-code")).toBeHidden();
		await pass.getByText("Show the code to type in").click();
		const code = pass.getByTestId("ticket-code");
		await expect(code).toBeVisible();
		// The value door check-in takes, character for character (groups are spacing, not spaces).
		expect(await code.textContent()).toBe(CODE);
		const lines = await code.evaluate((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)));
		expect(lines, label).toBeLessThanOrEqual(label === "desktop" ? 1 : 2);
		await shot(page, `pass-code-${label}`);
		await context.close();
	}
});

test("T158 printed, a QR pass carries the full code on one small line", async ({ browser }) => {
	const { context, page } = await open(browser, VIEW, DESKTOP);
	await page.emulateMedia({ media: "print" });
	const pass = page.getByTestId("ticket-pass").first();
	await expect(pass.getByTestId("ticket-qr")).toBeVisible();
	const line = pass.getByTestId("ticket-code-print");
	await expect(line).toBeVisible();
	expect(await line.textContent()).toBe(CODE);
	const { height, lineHeight, size } = await line.evaluate((el) => {
		const s = getComputedStyle(el);
		return { height: el.getBoundingClientRect().height, lineHeight: Number.parseFloat(s.lineHeight), size: Number.parseFloat(s.fontSize) };
	});
	expect(size).toBeLessThanOrEqual(12);
	expect(Math.round(height / lineHeight)).toBe(1);
	await shot(page, "confirmed-print");
	await context.close();
});

test("T158 without a QR the code is the way in: shown in full, grouped, on one line on a desktop", async ({ browser }) => {
	const { context, page } = await open(browser, `${VIEW}?qr=off`, DESKTOP);
	const code = page.getByTestId("ticket-pass").first().getByTestId("ticket-code");
	await expect(code).toBeVisible();
	expect(await code.textContent()).toBe(CODE);
	const lines = await code.evaluate((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)));
	expect(lines).toBe(1);
	await shot(page, "pass-no-qr-desktop", false);
	await page.emulateMedia({ media: "print" });
	await expect(code).toBeVisible();
	await context.close();
});
