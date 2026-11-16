import { describe, expect, it } from "vitest";

import { handleCheckoutForm } from "../../src/astro/lib/checkout-form";
import { fieldsFromIssues, requestDates } from "../../src/astro/lib/widget";

// T174a: the widget's request mode. A select of the dates the event takes requests for (allowed
// weekdays, notice, days ahead, closed dates), window radios, and the no-JS checkout posts `request`.

const KEY = "k".repeat(40);
const url = new URL("https://site.example/events/trek");

const requests = {
	windows: [{ id: "am", label: "AM", start: "10:00", end: "12:00" }],
	days: ["SA", "SU"],
	aheadDays: 14,
	noticeDays: 2,
	closedDates: ["2026-12-13"],
};

describe("T174a request dates", () => {
	it("T174a lists only allowed weekdays from the notice to the days ahead, without closed dates", () => {
		// Thursday 3 Dec 2026, late evening in London.
		const now = Date.parse("2026-12-03T23:30:00.000Z");
		const dates = requestDates(requests, "Europe/London", now, "en-GB").map((d) => d.value);
		// Sat 5 is the notice's first day; Sun 13 is closed; Sat 19 is past the 14 days.
		expect(dates).toEqual(["2026-12-05", "2026-12-06", "2026-12-12"]);
		expect(requestDates(requests, "Europe/London", now, "en-GB")[0]?.label).toMatch(/Saturday/);
	});

	it("T174a the day is the event zone's: just after midnight in Auckland is already the next day", () => {
		const now = Date.parse("2026-12-03T11:30:00.000Z"); // Fri 4 Dec 00:30 in Auckland
		const dates = requestDates({ ...requests, noticeDays: 1 }, "Pacific/Auckland", now).map((d) => d.value);
		expect(dates[0]).toBe("2026-12-05");
		const london = requestDates({ ...requests, noticeDays: 3 }, "Europe/London", now).map((d) => d.value);
		expect(london[0]).toBe("2026-12-06");
	});

	it("T174a a refused request date marks the date field", () => {
		expect(fieldsFromIssues([{ path: "request", code: "REQUEST_DATE" }])).toEqual(["occurrence"]);
	});
});

describe("T174a no-JS checkout of a request", () => {
	it("T174a posts the date and window as `request`, and refuses a form without them", async () => {
		const seen: unknown[] = [];
		const locals = {
			emdash: {
				handlePublicPluginApiRoute: async (_id: string, method: string, path: string, request: Request) => {
					if (method === "POST") seen.push(await request.clone().json());
					return path === "public/checkout/reserve"
						? { success: true, data: { ok: true, bookingRef: "ABCDEFGHJK", accessToken: "T".repeat(43) } }
						: { success: true, data: { ok: true, next: { type: "done" } } };
				},
			},
		} as never;
		const data = new FormData();
		for (const [k, v] of Object.entries({
			eventId: "ev1",
			"qty:party": "2",
			name: "Ada",
			email: "ada@example.com",
			idempotencyKey: KEY,
			needsRequest: "1",
			requestDate: "2026-12-12",
			requestWindow: "am",
		}))
			data.set(k, v);
		const out = await handleCheckoutForm({ locals, url }, data, {});
		expect(out.location).toBe("/booking?ref=ABCDEFGHJK");
		expect(seen[0]).toMatchObject({ eventId: "ev1", request: { date: "2026-12-12", window: "am" } });
		expect(seen[0]).not.toHaveProperty("occurrenceId");

		data.delete("requestWindow");
		data.set("returnTo", "/events/trek");
		const refused = await handleCheckoutForm({ locals, url }, data, {});
		expect(refused.location).toContain("booking_error=BAD_REQUEST");
		expect(refused.location).toContain("booking_fields=occurrence");
		expect(seen).toHaveLength(2);
	});
});
