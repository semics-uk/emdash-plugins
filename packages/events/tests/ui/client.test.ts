import { describe, expect, it } from "vitest";

import { formatMinor, freshKey, orderTotalMinor, validateBooking } from "../../src/client/booking";
import { IDEMPOTENCY_KEY_PATTERN, validateCheckoutFields } from "../../src/astro/lib/widget";

describe("booking client script (EU-FR-04, EU-NFR-03)", () => {
	it("EU-FR-04 makes a new key for every attempt, in the shape reserve accepts", () => {
		const keys = new Set(Array.from({ length: 20 }, () => freshKey()));
		expect(keys.size).toBe(20);
		for (const key of keys) expect(key).toMatch(IDEMPOTENCY_KEY_PATTERN);
	});

	it("EU-NFR-03 validates exactly as the server does, so a JS user sees the same errors", () => {
		const cases = [
			{ name: " ", email: "nope", lines: 0, needsOccurrence: true, occurrenceId: "" },
			{ name: "Ada", email: "ada@example.com", lines: 2, needsOccurrence: false, occurrenceId: "" },
			{ name: "Ada", email: "ada@", lines: 1, needsOccurrence: true, occurrenceId: "occ1" },
			{ name: "x".repeat(201), email: `${"a".repeat(250)}@example.com`, lines: 1, needsOccurrence: false, occurrenceId: "" },
		];
		for (const input of cases) expect(validateBooking(input)).toEqual(validateCheckoutFields(input));
		expect(validateBooking(cases[0] as (typeof cases)[0])).toEqual(["occurrence", "tickets", "name", "email"]);
	});

	it("EU-FR-04 totals the order and formats money from minor units", () => {
		expect(
			orderTotalMinor([
				{ qty: 2, priceMinor: 1250 },
				{ qty: 0, priceMinor: 999 },
				{ qty: Number.NaN, priceMinor: 100 },
			]),
		).toBe(2500);
		expect(formatMinor(2500, "GBP", "en-GB")).toBe("£25.00");
		expect(formatMinor(0, "GBP", "en-GB")).toBe("Free");
	});
});
