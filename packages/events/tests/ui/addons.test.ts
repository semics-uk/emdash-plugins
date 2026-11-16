import { describe, expect, it } from "vitest";

import { fieldsFromIssues } from "../../src/astro/lib/widget";
import { addonMax } from "../../src/client/booking";

// T174d: the widget's add-ons (Events Pro marks the types). With JavaScript an add-on's quantity is capped live by
// the places chosen; without it the server's refusal (`INVALID_QUANTITY` on `lines`) marks the tickets field.

describe("T174d add-ons in the booking widget", () => {
	it("T174d an add-on may go up to the places chosen, never past its own limit, and none without places", () => {
		expect(addonMax(4, 50)).toBe(4);
		expect(addonMax(4, 2)).toBe(2);
		expect(addonMax(0, 50)).toBe(0);
		expect(addonMax(-1, 50)).toBe(0);
	});

	it("T174d the server's refusal of too many add-ons marks the tickets", () => {
		expect(fieldsFromIssues([{ path: "lines", code: "INVALID_QUANTITY" }])).toEqual(["tickets"]);
	});
});
