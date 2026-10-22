import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

// T102 (EU-NFR-04, SU-NFR-06): the Events and E-sign UI kits in English and Arabic. `/e2e/i18n` renders
// every component with fixed data in one language; the ARIA snapshots (`__snapshots__/t102-i18n.spec.ts/`)
// hold what a screen reader gets in each language, and the right-to-left checks below prove the layouts
// mirror (logical CSS properties), reflow at 320 px and pass axe in Arabic too.

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const KITS = ["events", "esign"] as const;
const LANGS = ["en", "ar"] as const;
/** A heading from each kit, as a reader sees it (the snapshot holds the rest). */
const HEADINGS = {
	events: { en: "Book tickets", ar: "احجز التذاكر" },
	esign: { en: "Sign this document", ar: "وقّع هذا المستند" },
} as const;

async function open(browser: Browser, url: string, width = 1280): Promise<Page> {
	const context = await browser.newContext({ viewport: { width, height: 800 } });
	const page = await context.newPage();
	await page.goto(url);
	await page.waitForLoadState("networkidle");
	return page;
}

for (const kit of KITS) {
	for (const lang of LANGS) {
		test(`EU-NFR-04/SU-NFR-06 the ${kit} UI in ${lang} (ARIA snapshot)`, async ({ browser }) => {
			const page = await open(browser, `/e2e/i18n?kit=${kit}&lang=${lang}`);
			const dir = lang === "ar" ? "rtl" : "ltr";
			await expect(page.getByRole("heading", { name: HEADINGS[kit][lang] })).toBeVisible();
			// Every component root says its own language and direction, so it reads right inside any page.
			const roots = page.locator("main .semics-events, main .semics-esign");
			expect(await roots.count()).toBeGreaterThanOrEqual(3);
			for (const root of await roots.all()) {
				await expect(root).toHaveAttribute("lang", lang);
				await expect(root).toHaveAttribute("dir", dir);
			}
			if (kit === "esign") await expect(page.locator("[data-esign-pad-slot] canvas")).toHaveCount(1);
			await expect(page.locator("main")).toMatchAriaSnapshot({ name: `${kit}-${lang}.aria.yml` });
			await page.context().close();
		});
	}
}

test("EU-NFR-04 the Arabic booking widget mirrors: controls start on the right", async ({ browser }) => {
	const page = await open(browser, "/e2e/i18n?kit=events&lang=ar");
	const widget = page.locator(".semics-booking-widget");
	await expect(widget).toHaveCSS("direction", "rtl");
	const form = widget.locator("form[data-semics-booking]");
	const book = form.locator('button[type="submit"]').last();
	const formBox = await form.boundingBox();
	const bookBox = await book.boundingBox();
	if (!formBox || !bookBox) throw new Error("widget not laid out");
	// `justify-self: start` is the right edge in a right-to-left form.
	expect(Math.abs(formBox.x + formBox.width - (bookBox.x + bookBox.width))).toBeLessThan(2);
	expect(bookBox.x).toBeGreaterThan(formBox.x + 10);
	await page.context().close();
});

test("SU-NFR-06 the Arabic ceremony mirrors: the quote rule is on the right", async ({ browser }) => {
	const page = await open(browser, "/e2e/i18n?kit=esign&lang=ar");
	const quote = page.locator(".semics-ceremony blockquote");
	await expect(quote).toHaveCSS("direction", "rtl");
	await expect(quote).toHaveCSS("border-right-width", "3px");
	await expect(quote).toHaveCSS("border-left-width", "0px");
	await page.context().close();
});

for (const kit of KITS) {
	test(`EU-NFR-04/SU-NFR-06 the Arabic ${kit} UI reflows at 320 px and passes axe`, async ({ browser }) => {
		for (const width of [1280, 320]) {
			const page = await open(browser, `/e2e/i18n?kit=${kit}&lang=ar`, width);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			);
			expect(overflow, `${width} px`).toBeLessThanOrEqual(0);
			const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
			expect(
				results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
				`${width} px`,
			).toEqual([]);
			await page.context().close();
		}
	});
}
