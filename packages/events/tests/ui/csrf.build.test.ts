import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// T057: the no-JS forms refuse cross-site posts themselves (`isCrossSiteRequest`), so CSRF safety
// does not depend on the site keeping Astro's `security.checkOrigin` on.
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("T057 Origin checks on the no-JS forms", () => {
	it("T057 the booking page (cancel and redeem forms) checks before it reads the form", () => {
		const page = read("../../src/astro/BookingPage.astro");
		const guard = page.indexOf("isCrossSiteRequest(Astro.request");
		expect(guard).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(page.indexOf("Astro.request.formData()"));
	});

	it("EV-FR-12 the door signing page checks before it reads the form", () => {
		const page = read("../../src/astro/DoorSignPage.astro");
		const guard = page.indexOf("isCrossSiteRequest(Astro.request");
		expect(guard).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(page.indexOf("Astro.request.formData()"));
	});

	it("T057 POST /_events/checkout goes through the checked handler", () => {
		expect(read("../../src/astro/checkout-endpoint.ts")).toContain("handleCheckoutRequest(");
	});

	it("EV-FR-14 POST /_events/promo goes through the checked handler, exported for the integration (T078)", () => {
		expect(read("../../src/astro/promo-endpoint.ts")).toContain("handlePromoRequest(");
		expect(read("../../package.json")).toContain('"./astro/promo-endpoint": "./src/astro/promo-endpoint.ts"');
	});

	it("EV-FR-14 the widget offers the code field only when the core takes codes, in its own form (T078)", () => {
		const widget = read("../../src/astro/BookingWidget.astro");
		expect(widget).toContain("data?.promoCodes === true");
		// The code field and Apply belong to a separate form (Enter in the order's fields still books);
		// the order carries the applied code in a hidden field.
		expect(widget).toContain("action={PROMO_PATH}");
		expect(widget).toContain("form={promoForm}");
		expect(widget).toContain('type="hidden" name="promoCode"');
		// The script's submit button is the order's, never Apply.
		expect(read("../../src/client/booking.ts")).toContain(':not([data-promo-apply])');
	});
});
