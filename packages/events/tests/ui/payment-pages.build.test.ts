import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the pages (EU-FR-09, T057)", () => {
	it("EU-FR-09 the return component is a polite live region with no-JS fallbacks", () => {
		const component = source("../../src/astro/PaymentReturn.astro");
		expect(component).toContain('role="status"');
		expect(component).toContain('aria-live="polite"');
		expect(component).toContain("data-semics-payment");
		expect(component).toContain("Check again");
		expect(component).toContain('value="resume"');
	});

	it("EU-FR-09 the booking page renders it, ignores Stripe's session_id, and checks Origin before the resume form", () => {
		const page = source("../../src/astro/BookingPage.astro");
		expect(page).toContain("<PaymentReturn");
		expect(page).not.toContain("session_id");
		expect(page).toContain('"resume"');
		const guard = page.indexOf("isCrossSiteRequest(Astro.request");
		expect(guard).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(page.indexOf("Astro.request.formData()"));
		expect(guard).toBeLessThan(page.indexOf("resumePayment("));
	});

	it("EU-FR-09 the component is exported for sites that lay out their own booking page", () => {
		expect(source("../../package.json")).toContain('"./astro/PaymentReturn.astro"');
		expect(source("../../src/astro/index.js")).toContain("PaymentReturn");
	});
});
