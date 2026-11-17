import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { orderTotalMinor, tooFew } from "../../src/client/booking";
import { en } from "../../src/i18n/en";

// T174f: a party package (Events Pro marks the type `package` in `public/event`). The widget asks "How many
// people?" for it, from its fewest to its most people, and its price counts once whatever the party size.

const widget = readFileSync(fileURLToPath(new URL("../../src/astro/BookingWidget.astro", import.meta.url)), "utf8");

describe("T174f packages in the booking widget", () => {
	it("T174f a package's price counts once for any number of people; per-person lines multiply", () => {
		expect(orderTotalMinor([{ qty: 3, priceMinor: 12_000, package: true }])).toBe(12_000);
		expect(
			orderTotalMinor([
				{ qty: 3, priceMinor: 12_000, package: true },
				{ qty: 3, priceMinor: 1000 },
			]),
		).toBe(15_000);
		expect(orderTotalMinor([{ qty: 0, priceMinor: 12_000, package: true }])).toBe(0);
	});

	it("T174f the widget asks how many people for a package and marks its input", () => {
		expect(widget).toContain('t("widget.packagePeople"');
		expect(widget).toContain("data-package=");
	});

	it("T174g a quantity under a ticket type's fewest per order is refused before sending; none is fine", () => {
		expect(tooFew(2, 4)).toBe(true);
		expect(tooFew(1, 2)).toBe(true);
		expect(tooFew(0, 4)).toBe(false);
		expect(tooFew(4, 4)).toBe(false);
		expect(tooFew(9, 4)).toBe(false);
		expect(tooFew(3, Number.NaN)).toBe(false);
	});

	it("T174g the widget marks each input's fewest and says so when the buyer chooses fewer", () => {
		expect(widget).toContain("data-min=");
		expect(widget).toContain('"widget.field.minimum"');
		expect(en["widget.field.minimum"]).toContain("{min}");
	});
});
