import { describe, expect, it } from "vitest";

import {
	groupByDay,
	localDay,
	PICKER_PARAM,
	pickerFetchFrom,
	pickerHref,
	pickerParam,
	pickerView,
	usesPicker,
} from "../../src/astro/lib/picker";

// The booking form's day-then-time picker (T130, EV-FR-17): occurrences grouped by the event's local
// day, places left and full slots, month paging over `public/event`'s `from`, and when the form uses it.

const at = (iso: string, available = 4, id = iso) => ({ id, startsAt: iso, available });
const NOW = Date.parse("2026-11-03T08:00:00Z");

describe("grouping by local day (T130)", () => {
	it("EV-FR-17 puts each start on its day in the event's zone, earliest first", () => {
		// 03:30 UTC on 1 November is still 31 October in New York (EDT, UTC-4).
		const days = groupByDay([at("2026-11-01T14:00:00Z"), at("2026-11-01T03:30:00Z")], "America/New_York", "en-GB");
		expect(days.map((d) => [d.key, d.slots.map((s) => s.id)])).toEqual([
			["2026-10-31", ["2026-11-01T03:30:00Z"]],
			["2026-11-01", ["2026-11-01T14:00:00Z"]],
		]);
		expect(days[0]?.slots[0]?.time).toBe("23:30");
		expect(days[1]?.label).toMatch(/^Sunday,? 1 November 2026$/);
		expect(localDay(Date.parse("2026-11-01T03:30:00Z"), "UTC")).toBe("2026-11-01");
	});

	it("EV-FR-17 keeps a DST change day whole: both 01:30s of the repeated hour, and the day after the gap", () => {
		// New York falls back on 1 November 2026: 01:30 happens at 05:30Z (EDT) and 06:30Z (EST).
		const fall = groupByDay(
			[at("2026-11-01T05:30:00Z", 4, "a"), at("2026-11-01T06:30:00Z", 4, "b"), at("2026-11-02T05:00:00Z", 4, "c")],
			"America/New_York",
			"en-GB",
		);
		expect(fall.map((d) => [d.key, d.slots.map((s) => `${s.id}@${s.time}`)])).toEqual([
			["2026-11-01", ["a@01:30", "b@01:30"]],
			["2026-11-02", ["c@00:00"]],
		]);
		// London springs forward on 29 March 2026: 00:30 GMT, then 02:30 BST, both that day; 23:30 BST is still the 29th.
		const spring = groupByDay(
			[at("2026-03-29T00:30:00Z", 1, "x"), at("2026-03-29T01:30:00Z", 1, "y"), at("2026-03-29T22:30:00Z", 1, "z")],
			"Europe/London",
			"en-GB",
		);
		expect(spring.map((d) => [d.key, d.slots.map((s) => s.time)])).toEqual([
			["2026-03-29", ["00:30", "02:30", "23:30"]],
		]);
	});

	it("EV-FR-17 shows places left, and a full slot as full (disabled), a day with no room as full", () => {
		const [day] = groupByDay([at("2026-11-04T09:00:00Z", 1), at("2026-11-04T10:30:00Z", 0)], "UTC", "en-GB");
		expect(day?.slots.map((s) => [s.time, s.places, s.full, s.label])).toEqual([
			["09:00", "1 place left", false, "09:00, 1 place left"],
			["10:30", "Full", true, "10:30, Full"],
		]);
		expect(day?.open).toBe(true);
		const [full] = groupByDay([at("2026-11-05T09:00:00Z", 0)], "UTC", "en-GB");
		expect(full?.open).toBe(false);
		expect(full?.buttonLabel).toMatch(/^Thursday,? 5 November 2026, fully booked$/);
		// Places the core does not show read as nothing, not as full.
		const [unknown] = groupByDay([{ id: "u", startsAt: "2026-11-06T09:00:00Z", available: null }], "UTC", "en-GB");
		expect(unknown?.slots[0]).toMatchObject({ full: false, places: "", label: "09:00" });
	});

	it("falls back to UTC for a zone the runtime does not know, and translates (T102)", () => {
		const [day] = groupByDay([at("2026-11-04T09:00:00Z", 3)], "Not/AZone", "ar");
		expect(day?.key).toBe("2026-11-04");
		expect(day?.slots[0]?.places).not.toContain("places");
	});
});

describe("when the form uses the picker (T130)", () => {
	it("EV-FR-17 a schedule, or more than one start on a local day; never a single-date or one-a-day event", () => {
		expect(usesPicker(undefined)).toBe(false);
		expect(usesPicker({ occurrences: [] })).toBe(false);
		expect(usesPicker({ occurrences: [at("2026-11-04T09:00:00Z"), at("2026-11-05T09:00:00Z")] })).toBe(false);
		expect(usesPicker({ occurrences: [at("2026-11-04T09:00:00Z"), at("2026-11-04T18:00:00Z")] })).toBe(true);
		// 23:00 and 01:00 UTC are two days in UTC but one in Los Angeles.
		const lateAndEarly = [at("2026-11-04T23:00:00Z"), at("2026-11-05T01:00:00Z")];
		expect(usesPicker({ occurrences: lateAndEarly, timezone: "UTC" })).toBe(false);
		expect(usesPicker({ occurrences: lateAndEarly, timezone: "America/Los_Angeles" })).toBe(true);
		expect(usesPicker({ occurrences: [], slots: true })).toBe(true);
	});
});

describe("month view and paging (T130)", () => {
	const six = (day: string) => ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"].map((t) => at(`${day}T${t}:00Z`));
	const view = (occurrences: ReturnType<typeof at>[], start: string | null, more = false) =>
		pickerView(occurrences, { zone: "UTC", locale: "en-GB", start, now: NOW, more });

	it("EV-FR-17 lays out the month Monday first, with the days that have slots", () => {
		const v = view([...six("2026-11-04"), ...six("2026-11-30")], null);
		expect(v.month).toEqual({ key: "2026-11", label: "November 2026" });
		expect(v.weekdays.map((w) => w.short)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
		// 1 November 2026 is a Sunday: six blanks first.
		expect(v.weeks[0]?.slice(0, 7).map((c) => c?.day ?? null)).toEqual([null, null, null, null, null, null, 1]);
		expect(v.weeks.every((w) => w.length === 7)).toBe(true);
		expect(v.days.map((d) => d.key)).toEqual(["2026-11-04", "2026-11-30"]);
		const cell = v.weeks.flat().find((c) => c?.day === 4);
		expect(cell?.slots).toHaveLength(6);
		expect(v.weeks.flat().find((c) => c?.day === 5)?.slots).toEqual([]);
		expect(v.focusDay).toBe("2026-11-04");
		expect(v.prev).toBeUndefined();
		expect(v.next).toBeUndefined();
	});

	it("EV-FR-17 shows only the requested month, linking the next one when later slots exist", () => {
		const v = view([...six("2026-11-04"), ...six("2026-12-02")], null);
		expect(v.days.map((d) => d.key)).toEqual(["2026-11-04"]);
		expect(v.next).toBe("2026-12-01");
		const dec = view(six("2026-12-02"), "2026-12-01");
		expect(dec.month.key).toBe("2026-12");
		expect(dec.prev).toBe("2026-11-03"); // back to today, never before it
		expect(dec.next).toBeUndefined();
	});

	it("EV-FR-17 a truncated answer (`more`) drops its last, maybe partial, day and pages from it", () => {
		const v = view([...six("2026-11-04"), ...six("2026-11-05").slice(0, 2)], null, true);
		expect(v.days.map((d) => d.key)).toEqual(["2026-11-04"]);
		expect(v.next).toBe("2026-11-05");
		// Paging from the 5th: still November, back link to the month's start (clamped to today).
		const later = view(six("2026-11-05"), "2026-11-05");
		expect(later.month.key).toBe("2026-11");
		expect(later.prev).toBe("2026-11-03");
		// Truncated past the month's end: the next page is the next month.
		const spill = view([...six("2026-11-30"), ...six("2026-12-01")], null, true);
		expect(spill.next).toBe("2026-12-01");
	});

	it("ignores a past, malformed or impossible start, and skips the slots before it", () => {
		for (const start of ["2026-10-01", "nope", "2026-02-30", "2026-13-01"])
			expect(view([], start).month.key).toBe("2026-11");
		const v = view([...six("2026-11-04"), ...six("2026-11-20")], "2026-11-10");
		expect(v.days.map((d) => d.key)).toEqual(["2026-11-20"]);
		expect(v.prev).toBe("2026-11-03");
	});

	it("an empty month says so and still pages", () => {
		const v = view([], "2027-01-01");
		expect(v.days).toEqual([]);
		expect(v.month.key).toBe("2027-01");
		expect(v.prev).toBe("2026-12-01");
		// A month with nothing jumps to the first one that has slots.
		expect(view(six("2027-02-03"), "2027-01-01").month.key).toBe("2027-02");
	});

	it("asks public/event for the start's local midnight at the earliest zone offset; nothing for today", () => {
		expect(pickerFetchFrom(null)).toBeUndefined();
		expect(pickerFetchFrom("bad")).toBeUndefined();
		// UTC+14 is the earliest a local midnight can be.
		expect(pickerFetchFrom("2026-12-01")).toBe("2026-11-30T10:00:00.000Z");
	});

	it("builds page links that keep the page's query, drop old widget errors and go to the widget", () => {
		const url = new URL("https://site.test/events/range?x=1&booking_error=SOLD_OUT&booking_event=e1");
		expect(pickerHref(url, "2026-12-01", "e1")).toBe(
			`/events/range?x=1&${PICKER_PARAM}.e1=2026-12-01#semics-booking-e1`,
		);
	});

	it("T134 keys the page parameter per widget, so two pickers on a page page independently", () => {
		expect(pickerParam("e1")).toBe("booking_from.e1");
		expect(pickerParam("ev 2/x")).toBe("booking_from.ev_2_x");
		const url = new URL("https://site.test/events?booking_from.e2=2027-01-01");
		// Paging the first widget keeps the second one's month.
		expect(pickerHref(url, "2026-12-01", "e1")).toBe(
			"/events?booking_from.e2=2027-01-01&booking_from.e1=2026-12-01#semics-booking-e1",
		);
	});
});
