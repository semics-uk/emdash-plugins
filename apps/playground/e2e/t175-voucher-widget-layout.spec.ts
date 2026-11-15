import { expect, type Page, test } from "@playwright/test";

import { SECRET_KEY, WEBHOOK_SECRET } from "./harness/fake-stripe";
import { hasVouchers, requireVouchers, saveVoucherSettings } from "./harness/vouchers";

// T175 (lmsc-site #65, found on rc.16): <BuyVoucher>'s layout on a phone and in a narrow page column.
//  1. the live preview card grows to its content (its To / From panel was clipped below ~420px wide);
//  2. the form is one column in a narrow container, whatever the viewport (it went two-column at ~380px);
//  3. each kind / delivery radio sits at the top of its card, not stretched and centred above the icon;
//  4. the fields' borders have at least 3:1 contrast with their background (WCAG 1.4.11).
// Needs Vouchers Pro for the form to sell (on the Free build it says vouchers can't be bought); skipped otherwise.

test.beforeAll(async ({ request }) => {
	if (!(await hasVouchers(request))) return;
	await saveVoucherSettings(request, { stripeSecretKey: SECRET_KEY, stripeWebhookSecret: WEBHOOK_SECRET });
});

/** Relative luminance of a computed `rgb(...)` / `rgba(...)` colour (WCAG 2.x). */
function luminance(css: string): number {
	const [r, g, b] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((n) => {
		const c = Number(n) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

async function layoutChecks(page: Page) {
	const form = page.getByTestId("buy-voucher");
	await expect(form).toBeVisible();
	// What a buyer types: names and a few lines of message (the preview shows them; 500 characters are allowed).
	await form.getByLabel("Recipient's name").fill("James Alexander");
	await form.getByLabel("Your name").fill("Grace Hopper");
	const message = [
		"Happy birthday, James! Wishing you a brilliant day out on the water with the whole crew.",
		"We hope the sun shines, the wind is kind and you come back with stories to tell. See you at the club soon.",
		"Love, Grace",
	].join("\n");
	await form.getByLabel("Personal message").fill(message);
	await expect(page.getByTestId("voucher-preview")).toContainText("James Alexander");

	// 1. The card is not clipped: nothing overflows it, and its panel ends inside it.
	const card = page.getByTestId("voucher-preview");
	const sizes = await card.evaluate((el) => {
		const bottom = el.querySelector(".card-bottom")?.getBoundingClientRect().bottom ?? 0;
		return {
			scrollHeight: el.scrollHeight,
			clientHeight: el.clientHeight,
			panelBottom: bottom,
			cardBottom: el.getBoundingClientRect().bottom,
		};
	});
	expect.soft(sizes.scrollHeight, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.clientHeight);
	expect.soft(sizes.panelBottom).toBeLessThanOrEqual(sizes.cardBottom + 0.5);

	// 2. One column: the preview is below the form, and each pair of fields is stacked.
	const formBox = await form.boundingBox();
	const previewBox = await page.locator(".preview-column").boundingBox();
	expect.soft(previewBox?.y ?? 0).toBeGreaterThanOrEqual((formBox?.y ?? 0) + (formBox?.height ?? 0) - 1);
	const recipient = await form.getByLabel("Recipient's name").boundingBox();
	const buyer = await form.getByLabel("Your name").boundingBox();
	expect.soft(buyer?.y ?? 0).toBeGreaterThanOrEqual((recipient?.y ?? 0) + (recipient?.height ?? 0));
	expect.soft(Math.abs((buyer?.x ?? 0) - (recipient?.x ?? 0))).toBeLessThan(1);

	// 3. Each choice's radio is at the top of its card, above (not beside or below) the card's first line.
	const choices = form.locator("label.choice");
	expect(await choices.count()).toBeGreaterThan(0);
	for (const choice of await choices.all()) {
		const box = await choice.boundingBox();
		const radio = await choice.locator("input[type=radio]").boundingBox();
		const title = await choice.locator("strong").boundingBox();
		expect(radio, "radio").toBeTruthy();
		// Within the card's top padding band, not pushed down by stretching.
		expect.soft((radio?.y ?? 0) - (box?.y ?? 0)).toBeLessThanOrEqual(24);
		// Its own size, not stretched across the card.
		expect.soft(radio?.height ?? 0).toBeLessThanOrEqual(24);
		expect.soft(radio?.width ?? 0).toBeLessThanOrEqual(24);
		// Not overlapping the title text.
		const overlaps =
			(radio?.x ?? 0) < (title?.x ?? 0) + (title?.width ?? 0) &&
			(radio?.x ?? 0) + (radio?.width ?? 0) > (title?.x ?? 0) &&
			(radio?.y ?? 0) < (title?.y ?? 0) + (title?.height ?? 0) &&
			(radio?.y ?? 0) + (radio?.height ?? 0) > (title?.y ?? 0);
		expect.soft(overlaps, "radio overlaps the choice title").toBe(false);
	}

	// 4. Field borders: at least 3:1 against the field's background.
	for (const field of [form.getByLabel("Recipient's name"), form.getByLabel("Personal message")]) {
		const { border, background } = await field.evaluate((el) => {
			const s = getComputedStyle(el);
			return { border: s.borderTopColor, background: s.backgroundColor };
		});
		expect.soft(contrast(border, background), `${border} on ${background}`).toBeGreaterThanOrEqual(3);
	}
}

test("T175 BuyVoucher at a 375px viewport: card not clipped, one column, radios on top, field borders 3:1", async ({
	page,
	request,
}) => {
	await requireVouchers(request);
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/e2e/vouchers");
	await layoutChecks(page);
});

test("T175 BuyVoucher in a narrow column of a wide page follows its container, not the viewport", async ({
	page,
	request,
}) => {
	await requireVouchers(request);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/e2e/vouchers");
	await page.getByTestId("buy-voucher-section").evaluate((el) => {
		(el as HTMLElement).style.width = "380px";
	});
	await layoutChecks(page);
});
