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
});
