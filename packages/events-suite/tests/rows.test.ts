import { describe, expect, it } from "vitest";

import { money, people, rowsToShow } from "../src/astro/lib/rows";

// <BookingWithWaiver>'s attendee rows and summary (T157).
describe("attendee rows", () => {
	it("SX-FR-02 shows the first row, and every row up to the last one that holds something", () => {
		expect(rowsToShow([false, false, false, false])).toBe(1);
		expect(rowsToShow([true, false, false, false])).toBe(1);
		expect(rowsToShow([true, false, true, false])).toBe(3);
		expect(rowsToShow([false, false, false, true])).toBe(4);
		expect(rowsToShow([])).toBe(1);
	});
});

describe("summary line", () => {
	it("SX-FR-02 counts people from the page's own words", () => {
		expect(people(1, "{n} person", "{n} people")).toBe("1 person");
		expect(people(3, "{n} person", "{n} people")).toBe("3 people");
	});

	it("SX-FR-02 formats the total in the currency's minor unit; nothing to pay reads as the page's word", () => {
		expect(money(4500, "GBP", "en-GB", "Free")).toBe("£45.00");
		expect(money(1500, "JPY", "en-GB", "Free")).toBe("JP¥1,500");
		expect(money(0, "GBP", "en-GB", "Free")).toBe("Free");
		// A code Intl refuses still shows an amount.
		expect(money(4500, "£", "en-GB", "Free")).toBe("45.00 £");
	});
});
