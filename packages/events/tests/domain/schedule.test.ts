import { describe, expect, it } from "vitest";

import { validateConfigInput } from "../../src/domain/config";
import {
	dayBounds,
	MAX_SLOTS,
	parseSchedule,
	planSlots,
	type ScheduleDoc,
	SLOT_BATCH,
	scheduleOwned,
	slotId,
	slotStarts,
} from "../../src/domain/schedule";
import type { EventConfigDoc } from "../../src/storage/schema";

// Slot schedules (EV-FR-17, T129): one central schedule (weekdays x times, local to the event's zone)
// gives many bookable slots a day. Pure rules: validation, generation over the book-ahead window
// (closed dates, DST), and the plan the `occurrences` cron works from the config's catalog alone.

const DAY = 864e5;
const iso = (t: number) => new Date(t).toISOString();
const base: ScheduleDoc = {
	days: ["MO", "WE"],
	times: ["09:00", "18:30"],
	durationMinutes: 60,
	capacity: 12,
	bookAheadDays: 21,
	closedDates: [],
};
const MON = Date.parse("2026-11-02T00:00:00.000Z");

describe("parseSchedule (EV-FR-17)", () => {
	it("EV-FR-17 accepts a schedule and defaults book-ahead to 56 days and no closed dates", () => {
		expect(parseSchedule({ days: ["FR", "MO"], times: ["18:30", "09:00"], durationMinutes: 45, capacity: 8 })).toEqual({
			days: ["FR", "MO"],
			times: ["09:00", "18:30"],
			durationMinutes: 45,
			capacity: 8,
			bookAheadDays: 56,
			closedDates: [],
		});
	});

	it.each([
		["no days", { days: [] }],
		["an unknown day", { days: ["MO", "XX"] }],
		["a repeated day", { days: ["MO", "MO"] }],
		["no times", { times: [] }],
		["a time out of range", { times: ["24:00"] }],
		["a time without two digits", { times: ["9:00"] }],
		["a repeated time", { times: ["09:00", "09:00"] }],
		["more than 24 times", { times: Array.from({ length: 25 }, (_, i) => `00:${String(i).padStart(2, "0")}`) }],
		["a zero length", { durationMinutes: 0 }],
		["a length over a day", { durationMinutes: 1441 }],
		["no places", { capacity: 0 }],
		["fractional places", { capacity: 1.5 }],
		["book-ahead over 90 days", { bookAheadDays: 91 }],
		["book-ahead of 0", { bookAheadDays: 0 }],
		["an impossible closed date", { closedDates: ["2026-02-30"] }],
		["a closed date with a time", { closedDates: ["2026-12-25T00:00"] }],
		["over 366 closed dates", { closedDates: Array.from({ length: 367 }, () => "2026-12-25") }],
	])("EV-FR-17 refuses %s", (_, over) => {
		expect(parseSchedule({ ...base, ...over })).toBeNull();
	});

	it("EV-FR-17 refuses anything but an object", () => {
		expect(parseSchedule("MO 09:00")).toBeNull();
		expect(parseSchedule(null)).toBeNull();
	});
});

describe("schedule in config validation (EV-FR-17)", () => {
	const config = { status: "on_sale", capacity: 100, currency: "GBP" };
	const run = (input: unknown) =>
		validateConfigInput("e1", input, { config: null, ticketTypes: new Map(), occurrences: new Map() }, () => "n1");

	it("EV-FR-17 stores a valid schedule on the config", () => {
		const r = run({ config: { ...config, schedule: base } });
		expect(r.ok && r.value.config.schedule).toEqual(base);
	});

	it("EV-FR-17 refuses an invalid schedule as INVALID_SCHEDULE", () => {
		const r = run({ config: { ...config, schedule: { ...base, days: [] } } });
		expect(r.ok ? [] : r.error).toEqual([{ path: "config.schedule", code: "INVALID_SCHEDULE" }]);
	});

	it("EV-FR-17 an event has a schedule or a recurrence, never both", () => {
		const r = run({ config: { ...config, schedule: base, recurrence: "FREQ=WEEKLY" } });
		expect(r.ok ? [] : r.error).toEqual([{ path: "config.schedule", code: "INVALID_SCHEDULE" }]);
	});

	it("EV-FR-17 a schedule event has no dates of its own", () => {
		const r = run({
			config: { ...config, schedule: base },
			occurrences: [{ startsAt: "2026-12-01T10:00:00Z", capacity: 5 }],
		});
		expect(r.ok ? [] : r.error).toEqual([{ path: "config.schedule", code: "INVALID_SCHEDULE" }]);
	});

	it("EV-FR-17 a null schedule is no schedule", () => {
		const r = run({ config: { ...config, schedule: null } });
		expect(r.ok && "schedule" in r.value.config).toBe(false);
	});
});

describe("slot generation (EV-FR-17)", () => {
	it("EV-FR-17 generates every weekday x time inside the book-ahead window, across weeks", () => {
		const starts = slotStarts(base, "UTC", MON);
		// Mondays 2, 9, 16 and Wednesdays 4, 11, 18 November (23 Nov 09:00 is past the 21 days).
		expect(starts.map(iso)).toEqual(
			["02", "04", "09", "11", "16", "18"].flatMap((d) => [`2026-11-${d}T09:00:00.000Z`, `2026-11-${d}T18:30:00.000Z`]),
		);
	});

	it("EV-FR-17 leaves out slots already started and closed dates", () => {
		const starts = slotStarts({ ...base, closedDates: ["2026-11-11"] }, "UTC", MON + 10 * 3_600_000);
		expect(starts.map(iso)).not.toContain("2026-11-02T09:00:00.000Z");
		expect(starts.map(iso)).toContain("2026-11-02T18:30:00.000Z");
		expect(starts.some((t) => iso(t).startsWith("2026-11-11"))).toBe(false);
		// 2 Nov 18:30, 4, 9, 16, 18 Nov (two each) and 23 Nov 09:00 (inside 21 days of 10:00).
		expect(starts).toHaveLength(10);
	});

	it("EV-FR-17 times are local to the event's zone", () => {
		const [first] = slotStarts({ ...base, days: ["TU"], times: ["09:00"] }, "America/New_York", MON);
		expect(iso(first as number)).toBe("2026-11-03T14:00:00.000Z");
	});

	it("EV-FR-17 DST Europe/London spring: a slot time that does not exist that day is skipped", () => {
		const s = { ...base, days: ["SA", "SU", "MO"], times: ["01:30", "10:00"], bookAheadDays: 5 };
		const starts = slotStarts(s, "Europe/London", Date.parse("2027-03-26T12:00:00.000Z")).map(iso);
		expect(starts).toEqual([
			"2027-03-27T01:30:00.000Z", // Saturday, GMT
			"2027-03-27T10:00:00.000Z",
			// Sunday 28 March: clocks go from 01:00 to 02:00, so 01:30 does not exist.
			"2027-03-28T09:00:00.000Z", // 10:00 BST
			"2027-03-29T00:30:00.000Z", // Monday 01:30 BST
			"2027-03-29T09:00:00.000Z",
		]);
	});

	it("EV-FR-17 DST Europe/London autumn: an ambiguous slot time takes the first", () => {
		const s = { ...base, days: ["SA", "SU", "MO"], times: ["01:30", "10:00"], bookAheadDays: 5 };
		const starts = slotStarts(s, "Europe/London", Date.parse("2026-10-23T12:00:00.000Z")).map(iso);
		expect(starts).toEqual([
			"2026-10-24T00:30:00.000Z", // Saturday 01:30 BST
			"2026-10-24T09:00:00.000Z",
			// Sunday 25 October: 01:00-01:59 happens twice; the first 01:30 is still BST.
			"2026-10-25T00:30:00.000Z",
			"2026-10-25T10:00:00.000Z", // 10:00 GMT
			"2026-10-26T01:30:00.000Z",
			"2026-10-26T10:00:00.000Z",
		]);
	});

	it("EV-FR-17 limits: never more than MAX_SLOTS ahead, the earliest first", () => {
		const times = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
		const days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
		const starts = slotStarts({ ...base, days, times, bookAheadDays: 90 }, "UTC", MON);
		expect(starts).toHaveLength(MAX_SLOTS);
		expect(iso(starts[0] as number)).toBe("2026-11-02T00:00:00.000Z");
		expect(starts.every((t, i) => i === 0 || t > (starts[i - 1] as number))).toBe(true);
	});

	it("EV-FR-17 6 times a day, every day, 90 days ahead fits under the limit (6 x 7 x 13 weeks)", () => {
		const times = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"];
		const days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
		const starts = slotStarts({ ...base, days, times, bookAheadDays: 90 }, "Europe/London", MON);
		expect(starts).toHaveLength(6 * 90);
		expect(MAX_SLOTS).toBeGreaterThanOrEqual(6 * 7 * 13);
	});

	it("EV-FR-17 dayBounds is the local day in the zone", () => {
		expect(dayBounds("2026-10-25", "Europe/London")?.map(iso)).toEqual([
			"2026-10-24T23:00:00.000Z",
			"2026-10-26T00:00:00.000Z",
		]);
		expect(dayBounds("2026-02-30", "UTC")).toBeNull();
	});
});

describe("slot plan (EV-FR-17, R22)", () => {
	const entry = (t: number, over: Record<string, unknown> = {}) => ({
		capacity: 12,
		startsAt: iso(t),
		status: "open",
		...over,
	});
	const config = (schedule: ScheduleDoc | null, occurrences: Record<string, unknown> = {}, over = {}) =>
		({
			status: "on_sale",
			capacity: 100,
			reserved: 0,
			sold: 0,
			currency: "GBP",
			questions: [],
			signature: { required: false, mode: "each_attendee" },
			waitlistEnabled: false,
			schedule,
			catalog: { ticketTypes: {}, occurrences },
			info: { title: "Range", startsAt: iso(MON), endsAt: null, timezone: "UTC", venue: null },
			...over,
		}) as EventConfigDoc;

	it("EV-FR-17 a new schedule adds the earliest slots, SLOT_BATCH a run", () => {
		const s = { ...base, days: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"], times: ["09:00", "10:00", "11:00"] };
		const plan = planSlots("ev", config(s), MON);
		expect(plan?.add).toHaveLength(SLOT_BATCH);
		expect(plan?.add[0]).toEqual({
			id: slotId("ev", Date.parse("2026-11-02T09:00:00.000Z")),
			t: Date.parse("2026-11-02T09:00:00.000Z"),
		});
	});

	it("EV-FR-17 slots already in the catalog are kept as they are (overrides survive)", () => {
		const starts = slotStarts(base, "UTC", MON);
		const have = Object.fromEntries(
			starts.map((t, i) => [slotId("ev", t), entry(t, i === 0 ? { status: "closed", capacity: 3 } : {})]),
		);
		expect(planSlots("ev", config(base, have), MON)).toBeNull();
	});

	it("EV-FR-17 future slots the schedule no longer gives are stale; past ones are pruned after a week", () => {
		const gone = Date.parse("2026-11-03T09:00:00.000Z"); // a Tuesday
		const old = MON - 8 * DAY;
		const recent = MON - DAY;
		const starts = slotStarts(base, "UTC", MON);
		const have = {
			...Object.fromEntries(starts.map((t) => [slotId("ev", t), entry(t)])),
			[slotId("ev", gone)]: entry(gone),
			[slotId("ev", old)]: entry(old),
			[slotId("ev", recent)]: entry(recent),
			"manual-1": entry(gone),
		};
		const plan = planSlots("ev", config(base, have), MON);
		expect(plan).toMatchObject({ add: [], stale: [slotId("ev", gone)], prune: [slotId("ev", old)], drop: [] });
	});

	it("EV-FR-17 unlisted slots are dropped only after the grace period, and nothing else is unlisted meanwhile", () => {
		const starts = slotStarts(base, "UTC", MON);
		const have = Object.fromEntries(starts.map((t) => [slotId("ev", t), entry(t)]));
		const gone = Date.parse("2026-11-03T09:00:00.000Z");
		const extra = { [slotId("ev", gone)]: entry(gone) };
		const pending = { unlisted: { ids: ["s-ev-old"], at: MON } };
		expect(planSlots("ev", config(base, { ...have, ...extra }, pending), MON + 60_000)).toBeNull();
		expect(planSlots("ev", config(base, { ...have, ...extra }, pending), MON + 5 * 60_000)).toMatchObject({
			drop: ["s-ev-old"],
			stale: [],
			ready: true,
		});
	});

	it("EV-FR-17 an unknown zone plans in UTC", () => {
		const c = config(base);
		c.info = { title: "Range", startsAt: iso(MON), endsAt: null, timezone: "Nowhere/Zone", venue: null };
		expect(planSlots("ev", c, MON)?.add[0]?.t).toBe(Date.parse("2026-11-02T09:00:00.000Z"));
	});

	it("EV-FR-17 no schedule, no plan", () => {
		expect(planSlots("ev", config(null), MON)).toBeNull();
	});

	it("EV-FR-17 schedule-owned: a schedule, or slots made by one", () => {
		expect(scheduleOwned(config(base))).toBe(true);
		expect(scheduleOwned(config(null, { [slotId("ev", MON)]: entry(MON) }))).toBe(true);
		expect(scheduleOwned(config(null, { "r-ev-1": entry(MON) }))).toBe(false);
		expect(scheduleOwned(null)).toBe(false);
	});
});
