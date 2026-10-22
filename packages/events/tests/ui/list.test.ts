import { describe, expect, it } from "vitest";

import { cardView, eventHref, listView, type PublicEventSummary } from "../../src/astro/lib/list";

const base: PublicEventSummary = {
	eventId: "e1",
	title: "London Community Meetup",
	status: "on_sale",
	startsAt: "2030-03-14T18:30:00.000Z",
	endsAt: "2030-03-14T21:00:00.000Z",
	timezone: "Europe/London",
	venue: "The Old Library",
	currency: "GBP",
	priceFromMinor: 0,
	available: 10,
};

describe("event list view (EU-FR-03, EU-US-4)", () => {
	it("EU-FR-03 shows each event in its own time zone", () => {
		const london = cardView(base, "en-GB");
		expect(london.when).toContain("18:30");
		expect(london.when).toContain("GMT");
		// 22:00 UTC on 5 November is 09:00 the next day in Sydney (AEDT, UTC+11).
		const sydney = cardView(
			{ ...base, startsAt: "2030-11-05T22:00:00.000Z", endsAt: null, timezone: "Australia/Sydney" },
			"en-GB",
		);
		expect(sydney.when).toContain("6 Nov 2030");
		expect(sydney.when).toContain("09:00");
		const nyc = cardView({ ...base, startsAt: "2030-06-20T14:00:00.000Z", timezone: "America/New_York" }, "en-GB");
		expect(nyc.when).toContain("10:00");
		expect(nyc.datetime).toBe("2030-06-20T14:00:00.000Z");
	});

	it("EU-FR-03 falls back to UTC for a missing or unknown zone", () => {
		expect(cardView({ ...base, timezone: null }, "en-GB").when).toContain("UTC");
		expect(cardView({ ...base, timezone: "Nowhere/Land" }, "en-GB").when).toContain("UTC");
	});

	it("EU-FR-03 labels price and availability without exposing counters", () => {
		expect(cardView(base, "en-GB").price).toBe("Free");
		expect(cardView({ ...base, priceFromMinor: 1500 }, "en-GB").price).toBe("From £15.00");
		expect(cardView({ ...base, priceFromMinor: undefined }, "en-GB").price).toBeNull();
		expect(cardView({ ...base, available: 0 }, "en-GB").badge).toBe("Sold out");
		expect(cardView({ ...base, status: "cancelled" }, "en-GB").badge).toBe("Cancelled");
		expect(cardView({ ...base, status: "closed" }, "en-GB").badge).toBe("Sales closed");
		expect(cardView({ ...base, status: "paused" }, "en-GB").badge).toBe("Sales paused");
		expect(cardView(base, "en-GB").badge).toBeNull();
	});

	it("EU-US-4 limits the list and treats a non-positive limit as none", () => {
		const events = [base, { ...base, eventId: "e2" }, { ...base, eventId: "e3" }];
		expect(listView(events, { limit: 2, locale: "en-GB" }).map((c) => c.eventId)).toEqual(["e1", "e2"]);
		expect(listView(events, { limit: 0, locale: "en-GB" })).toEqual([]);
		expect(listView([], { limit: 3, locale: "en-GB" })).toEqual([]);
	});

	it("EU-FR-03 links a card to its event page by the entry's slug by default (T056)", () => {
		expect(eventHref({ ...base, slug: "london-meetup" })).toBe("/events/london-meetup");
		expect(eventHref({ ...base, slug: "a b/c" })).toBe("/events/a%20b%2Fc");
		expect(eventHref(base)).toBeUndefined();
	});
});
