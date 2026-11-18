import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { type PublicRequests, requestDates, requestWindows } from "../../src/astro/lib/widget";

// T176 in the widget: each date in the request select carries the ids of the windows it offers (the first
// matching rule's, else the event's), and a small script shows only those radios. Without JavaScript every
// window is listed once and the server refuses one the date does not offer.

const widget = readFileSync(fileURLToPath(new URL("../../src/astro/BookingWidget.astro", import.meta.url)), "utf8");

const LATE = [
	{ id: "late-1", label: "Late 1", start: "15:30", end: "17:00" },
	{ id: "late-2", label: "Late 2", start: "17:00", end: "18:30" },
];
const LMSC: PublicRequests = {
	windows: [
		{ id: "morning", label: "Morning", start: "10:00", end: "12:00" },
		{ id: "afternoon", label: "Afternoon", start: "12:00", end: "15:30" },
	],
	days: ["WE", "SA", "SU"],
	aheadDays: 365,
	noticeDays: 0,
	closedDates: [],
	rules: [{ days: ["WE"], from: "04-01", to: "10-31", summer: true, windows: LATE }],
};

const offered = (r: PublicRequests, zone = "Europe/London") =>
	Object.fromEntries(
		requestDates(r, zone, Date.parse("2027-02-10T12:00:00.000Z"), "en-GB").map((d) => [d.value, d.windows]),
	);

describe("T176 the windows each request date offers", () => {
	it("T176 a summer Wednesday offers the late windows; a winter one and weekends the normal ones", () => {
		const by = offered(LMSC);
		expect(by["2027-04-07"]).toEqual(["late-1", "late-2"]);
		expect(by["2027-10-27"]).toEqual(["late-1", "late-2"]);
		expect(by["2027-03-24"]).toEqual(["morning", "afternoon"]);
		expect(by["2027-11-03"]).toEqual(["morning", "afternoon"]);
		expect(by["2027-04-10"]).toEqual(["morning", "afternoon"]);
	});

	it("T176 `summer` follows the zone's clocks; a range wraps the year; the first rule wins", () => {
		const summer = offered({ ...LMSC, rules: [{ summer: true, windows: LATE }] });
		expect(summer["2027-03-27"]).toEqual(["morning", "afternoon"]);
		expect(summer["2027-03-28"]).toEqual(["late-1", "late-2"]);
		const sydney = offered({ ...LMSC, rules: [{ summer: true, windows: LATE }] }, "Australia/Sydney");
		expect(sydney["2027-07-14"]).toEqual(["morning", "afternoon"]);
		expect(sydney["2027-12-15"]).toEqual(["late-1", "late-2"]);
		const xmas = [{ id: "xmas", label: "Xmas", start: "11:00", end: "13:00" }];
		const wrap = offered({
			...LMSC,
			rules: [
				{ from: "12-20", to: "01-05", windows: xmas },
				{ days: ["SA"], windows: LATE },
			],
		});
		expect(wrap["2027-12-25"]).toEqual(["xmas"]);
		expect(wrap["2027-12-18"]).toEqual(["late-1", "late-2"]);
		expect(wrap["2027-12-19"]).toEqual(["morning", "afternoon"]);
	});

	it("T176 no rules: every date offers the event's windows", () => {
		const plain = offered({ ...LMSC, rules: undefined });
		expect(Object.values(plain).every((w) => w.join() === "morning,afternoon")).toBe(true);
	});

	it("T176 every window is listed once, the event's first, for the radios", () => {
		expect(requestWindows(LMSC).map((w) => w.id)).toEqual(["morning", "afternoon", "late-1", "late-2"]);
		expect(requestWindows({ ...LMSC, rules: undefined })).toEqual(LMSC.windows);
	});

	it("T176 the widget lists every window, marks each date's windows and shows only those with JavaScript", () => {
		expect(widget).toContain('data-windows={d.windows.join(" ")}');
		expect(widget).toContain("requestWindows(requests)");
		expect(widget).toContain('data-testid="booking-windows"');
		expect(widget).toContain("dataset.windows");
	});
});
