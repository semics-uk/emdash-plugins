import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// T080 (EV-FR-15, EU-FR-10): custom attendee questions in the real <BookingWidget>, in a real browser.
// Questions are Events Pro's and the playground runs the Free cores (R40), so `/e2e/questions` passes
// the event as Pro's `public/event` answers it. Required answers at reserve, their storage and the CSV
// are proven on the Pro bundle (`events-pro/tests/questions.editions.test.ts`).

const PAGE = "/e2e/questions";

async function seriousViolations(page: Page) {
	const results = await new AxeBuilder({ page }).include(".semics-events").analyze();
	return results.violations
		.filter((v) => v.impact === "serious" || v.impact === "critical")
		.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("EU-FR-10 each question type renders as a labelled control, required ones required", async ({ page }) => {
	await page.goto(PAGE);
	const widget = page.getByTestId("booking-widget");
	const diet = widget.getByRole("textbox", { name: /Dietary needs/ });
	await expect(diet).toBeVisible();
	await expect(diet).not.toHaveAttribute("required", /.*/);
	await expect(widget.getByText("(optional)")).toBeVisible();
	const size = widget.getByRole("combobox", { name: "T-shirt size" });
	await expect(size).toHaveAttribute("required", "");
	await expect(size.locator("option")).toHaveText(["Choose an answer", "S", "M", "L"]);
	const terms = widget.getByRole("checkbox", { name: "I accept the code of conduct" });
	await expect(terms).toHaveAttribute("required", "");
	await expect(widget.getByRole("group", { name: "About you" })).toBeVisible();
	expect(await seriousViolations(page)).toEqual([]);
});

test("EU-FR-10 with JS, unanswered required questions are flagged before anything is sent", async ({ page }) => {
	await page.goto(PAGE);
	const widget = page.getByTestId("booking-widget");
	await widget.getByLabel(/General/).fill("1");
	await widget.getByLabel("Your name").fill("Ada Lovelace");
	await widget.getByLabel("Email").fill("ada@example.com");
	await widget.getByRole("button", { name: "Book" }).click();
	await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
	const size = widget.getByRole("combobox", { name: "T-shirt size" });
	await expect(size).toHaveAttribute("aria-invalid", "true");
	await expect(size).toBeFocused();
	await expect(widget.getByText("Choose an answer.")).toBeVisible();
	await expect(widget.getByText("Tick this box to continue.")).toBeVisible();
	await expect(widget.getByRole("textbox", { name: /Dietary needs/ })).not.toHaveAttribute("aria-invalid", "true");
	expect(await seriousViolations(page)).toEqual([]);
});

test("EU-FR-10 a refusal from the server marks the question it names", async ({ page }) => {
	await page.goto(`${PAGE}?booking_error=BAD_REQUEST&booking_fields=q:qterms&booking_event=e2e-questions`);
	const widget = page.getByTestId("booking-widget");
	const terms = widget.getByRole("checkbox", { name: "I accept the code of conduct" });
	await expect(terms).toHaveAttribute("aria-invalid", "true");
	await expect(terms).toHaveAccessibleDescription("Tick this box to continue.");
	await expect(widget.locator("[data-form-alert]")).toHaveText("Please check the highlighted details.");
});
