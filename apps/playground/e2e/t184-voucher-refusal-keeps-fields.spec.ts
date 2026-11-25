import { expect, test } from "@playwright/test";

import { SECRET_KEY, WEBHOOK_SECRET } from "./harness/fake-stripe";
import { hasVouchers, requireVouchers, saveVoucherSettings } from "./harness/vouchers";

// T183, T184 (lmsc-site #148; rc.33's restore set only radios): a refused purchase comes back to the form's alert,
// names the field to fix, and puts back what was typed (text, textarea and radios), from this tab's storage only.
// "a@b" passes the browser's email check but not the suite's, so the suite refuses it as BAD_REQUEST, buyerEmail.
// Needs Vouchers Pro for the form to sell; skipped otherwise.

test.beforeAll(async ({ request }) => {
	if (!(await hasVouchers(request))) return;
	await saveVoucherSettings(request, { stripeSecretKey: SECRET_KEY, stripeWebhookSecret: WEBHOOK_SECRET });
});

test("T184 a refused purchase lands on the alert, names the field and keeps the text fields", async ({
	page,
	request,
}) => {
	await requireVouchers(request);
	await page.goto("/e2e/vouchers");
	const form = page.getByTestId("buy-voucher");
	await form.getByLabel("Money voucher").check();
	const other = form.getByLabel("Another amount");
	const custom = (await other.count()) > 0;
	if (custom) {
		await other.check();
		await form.getByLabel("Amount (£)").fill("65");
	}
	const message = "Happy Birthday!\n\nLove from Mum & Dad xxx";
	await form.getByLabel("Recipient's name").fill("Kept Recipient");
	await form.getByLabel("Your name").fill("Grace Hopper");
	await form.getByLabel("Your email").fill("a@b");
	await form.getByLabel("Personal message").fill(message);
	await form.getByRole("button", { name: /Buy/ }).click();

	await expect(page).toHaveURL(/voucher_error=BAD_REQUEST.*#semics-buy-voucher$/);
	expect(page.url()).not.toContain("Kept");
	await expect(page.getByTestId("buy-voucher-error")).toContainText("Your email");
	await expect(form.getByLabel("Recipient's name")).toHaveValue("Kept Recipient");
	await expect(form.getByLabel("Your name")).toHaveValue("Grace Hopper");
	await expect(form.getByLabel("Your email")).toHaveValue("a@b");
	await expect(form.getByLabel("Personal message")).toHaveValue(message);
	if (custom) {
		await expect(other).toBeChecked();
		await expect(form.getByLabel("Amount (£)")).toHaveValue("65");
	}

	// Once only: a reload of the refusal page does not bring the details back.
	await page.reload();
	await expect(form.getByLabel("Recipient's name")).toHaveValue("");
});
