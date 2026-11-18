import { describe, expect, it } from "vitest";

import { requestFields, requestsInput } from "../../src/admin/schedule";
import { planCheckout, type ReserveInput } from "../../src/domain/checkout";
import { catalogOf, validateConfigInput } from "../../src/domain/config";
import { parseRequests, requestStart, windowOf, windowsOn } from "../../src/domain/schedule";
import { requestText } from "../../src/emails/confirmation";
import type { EventConfigDoc, RequestsDoc, TicketTypeDoc } from "../../src/storage/schema";

// T176: booking-request windows that change by weekday, date range and daylight-saving season
// (`config.requests.rules`). The first rule that matches a local date replaces `windows` for it.
// LMSC: Morning and Afternoon every open day; from April until the clocks go back, Wednesdays offer
// only the late windows.

const NOW = Date.parse("2027-02-10T12:00:00.000Z");
const KEY = "k".repeat(32);

const LATE = [
	{ id: "late-1", label: "Late 1", start: "15:30", end: "17:00" },
	{ id: "late-2", label: "Late 2", start: "17:00", end: "18:30" },
];
const LMSC: RequestsDoc = {
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

const tt: TicketTypeDoc = {
	eventId: "e1",
	name: "Party",
	priceMinor: 0,
	capacity: 10,
	reserved: 0,
	sold: 0,
	hidden: false,
	sort: 0,
};

const config = (requests: RequestsDoc = LMSC, timezone = "Europe/London"): EventConfigDoc => ({
	status: "on_sale",
	capacity: 20,
	reserved: 0,
	sold: 0,
	currency: "GBP",
	questions: [],
	signature: { required: false, mode: "each_attendee" },
	waitlistEnabled: false,
	requests,
	info: { title: "Quads", startsAt: "2027-01-01T09:00:00.000Z", endsAt: null, timezone, venue: null },
	catalog: catalogOf([{ id: "tt_a", data: tt }], []),
});

const ids = (c: EventConfigDoc, date: string) => windowsOn(c, date).map((w) => w.id);

describe("T176 windows on a date", () => {
	it("T176 a summer Wednesday offers only the late windows; a winter Wednesday and a summer Saturday the normal ones", () => {
		const c = config();
		expect(ids(c, "2027-04-07")).toEqual(["late-1", "late-2"]); // first summer Wednesday (BST since 28 Mar)
		expect(ids(c, "2027-03-24")).toEqual(["morning", "afternoon"]); // GMT, and before 1 April
		expect(ids(c, "2027-04-10")).toEqual(["morning", "afternoon"]); // a Saturday
		// The clocks go back on Sunday 31 October 2027: the 27th is still summer.
		expect(ids(c, "2027-10-27")).toEqual(["late-1", "late-2"]);
		expect(ids(c, "2027-11-03")).toEqual(["morning", "afternoon"]);
	});

	it("T176 `summer` alone follows the clocks, whatever the year; in the south summer is January", () => {
		const rules = [{ summer: true, windows: LATE }];
		const london = config({ ...LMSC, rules });
		expect(ids(london, "2027-03-27")).toEqual(["morning", "afternoon"]); // the Saturday before the change
		expect(ids(london, "2027-03-28")).toEqual(["late-1", "late-2"]); // BST from 01:00 that day
		expect(ids(london, "2028-10-28")).toEqual(["late-1", "late-2"]);
		expect(ids(london, "2028-10-30")).toEqual(["morning", "afternoon"]);
		const sydney = config({ ...LMSC, rules }, "Australia/Sydney");
		expect(ids(sydney, "2027-01-15")).toEqual(["late-1", "late-2"]);
		expect(ids(sydney, "2027-07-15")).toEqual(["morning", "afternoon"]);
		// A zone with no daylight saving never has summer.
		expect(ids(config({ ...LMSC, rules }, "UTC"), "2027-07-15")).toEqual(["morning", "afternoon"]);
	});

	it("T176 a range is inclusive and wraps the year when `from` is after `to`; the first matching rule wins", () => {
		const xmas = [{ id: "xmas", label: "Xmas", start: "11:00", end: "13:00" }];
		const c = config({
			...LMSC,
			rules: [
				{ from: "12-20", to: "01-05", windows: xmas },
				{ days: ["SA"], windows: LATE },
			],
		});
		expect(ids(c, "2027-12-20")).toEqual(["xmas"]);
		expect(ids(c, "2028-01-05")).toEqual(["xmas"]);
		expect(ids(c, "2027-12-25")).toEqual(["xmas"]); // a Saturday: the first rule wins
		expect(ids(c, "2028-01-08")).toEqual(["late-1", "late-2"]);
		expect(ids(c, "2028-01-06")).toEqual(["morning", "afternoon"]);
		expect(ids(c, "2027-12-19")).toEqual(["morning", "afternoon"]);
	});

	it("T176 no requests offer nothing; a bad date gives the event's windows without throwing", () => {
		expect(windowsOn({ requests: null, info: null }, "2027-04-07")).toEqual([]);
		expect(ids(config(), "2027-02-30")).toEqual(["morning", "afternoon"]);
		expect(ids(config(), "soon")).toEqual(["morning", "afternoon"]);
	});

	it("T176 a window is found by id across the event's windows and every rule's", () => {
		expect(windowOf(config(), "late-2")).toEqual(LATE[1]);
		expect(windowOf(config(), "morning")?.label).toBe("Morning");
		expect(windowOf(config(), "nope")).toBeUndefined();
		expect(windowOf(null, "late-2")).toBeUndefined();
		expect(requestText({ date: "2027-04-07", window: "late-1" }, config())).toBe("Wed 7 Apr, Late 1");
	});
});

describe("T176 reserve", () => {
	const input = (date: string, window: string): ReserveInput => ({
		eventId: "e1",
		lines: [{ ticketTypeId: "tt_a", qty: 2 }],
		buyer: { name: "Ada", email: "ada@example.com" },
		idempotencyKey: KEY,
		request: { date, window },
	});
	const plan = (date: string, window: string) =>
		planCheckout("e1", config(), input(date, window), NOW, { maxSteps: 6 });

	it("T176 the server refuses a normal window on a summer Wednesday and a late one on a winter Wednesday", () => {
		expect(plan("2027-04-07", "late-1").ok).toBe(true);
		expect(plan("2027-04-07", "morning")).toMatchObject({ error: { code: "BAD_REQUEST", reason: "REQUEST_WINDOW" } });
		expect(plan("2027-03-24", "morning").ok).toBe(true);
		expect(plan("2027-03-24", "late-2")).toMatchObject({ error: { code: "BAD_REQUEST", reason: "REQUEST_WINDOW" } });
		// Thursday is not open: a late window is not offered then, and Morning is a date refusal.
		expect(plan("2027-04-08", "late-1")).toMatchObject({ error: { reason: "REQUEST_WINDOW" } });
		expect(plan("2027-04-08", "morning")).toMatchObject({ error: { reason: "REQUEST_DATE" } });
	});

	it("T176 a rule's window starts at its own local time (BST)", () => {
		expect(requestStart(config(), { date: "2027-04-07", window: "late-1" }, NOW)).toBe(
			Date.parse("2027-04-07T14:30:00.000Z"),
		);
		expect(requestStart(config(), { date: "2027-04-07", window: "morning" }, NOW)).toBeNaN();
	});
});

describe("T176 rules config", () => {
	const raw = (rules: unknown) => ({ windows: LMSC.windows, days: ["WE"], rules });

	it("T176 keeps valid rules; leaves `rules` out when there are none", () => {
		expect(parseRequests(LMSC)).toEqual(LMSC);
		expect(parseRequests(raw([{ days: ["WE"], windows: LATE }]))?.rules).toEqual([{ days: ["WE"], windows: LATE }]);
		expect(parseRequests(raw(undefined))).not.toHaveProperty("rules");
		expect(parseRequests(raw(null))).not.toHaveProperty("rules");
		expect(parseRequests(raw([]))).not.toHaveProperty("rules");
	});

	it("T176 refuses bad rules", () => {
		const bad = [
			"x",
			[{ windows: [] }],
			[{ windows: LATE, x: 1 }],
			[{ days: ["XX"], windows: LATE }],
			[{ days: [], windows: LATE }],
			[{ from: "13-01", to: "10-31", windows: LATE }],
			[{ from: "04-01", windows: LATE }], // a range needs both ends
			[{ to: "04-01", windows: LATE }],
			[{ summer: "yes", windows: LATE }],
			[{ windows: [{ id: "morning", label: "Again", start: "15:30", end: "17:00" }] }], // ids are unique overall
			[{ windows: LATE }, { windows: LATE }],
			[{ windows: [{ id: "late", label: "Late", start: "17:00", end: "15:30" }] }],
			Array.from({ length: 11 }, (_, i) => ({ windows: [{ id: `w${i}`, label: "W", start: "10:00", end: "11:00" }] })),
		];
		for (const rules of bad) expect(parseRequests(raw(rules)), JSON.stringify(rules)).toBeNull();
		const ten = Array.from({ length: 10 }, (_, i) => ({
			windows: [{ id: `w${i}`, label: "W", start: "10:00", end: "11:00" }],
		}));
		expect(parseRequests(raw(ten))?.rules).toHaveLength(10);
	});

	it("T176 config/save keeps the rules", () => {
		const empty = { config: null, ticketTypes: new Map(), occurrences: new Map() };
		const out = validateConfigInput(
			"e1",
			{
				eventId: "e1",
				config: { status: "on_sale", capacity: 10, currency: "GBP", requests: LMSC },
				ticketTypes: [],
				occurrences: [],
			},
			empty,
			() => "id1",
		);
		expect(out.ok && out.value.config.requests).toEqual(LMSC);
	});
});

describe("T176 the panel keeps the rules (set through config/save only)", () => {
	const values = {
		rq_windows: "Morning 10:00-12:00\nAfternoon 12:00-15:30",
		rq_days: "WE, SA, SU",
		rq_ahead: "365",
		rq_notice: "0",
		rq_closed: "",
	};

	it("T176 a panel save of the requests fields leaves the stored rules unchanged", () => {
		const asked = requestsInput(values, LMSC);
		expect(asked).toEqual(LMSC);
		expect(parseRequests(asked)).toEqual(LMSC);
		// The rules stay last, so an unchanged form compares equal to what is stored.
		expect(JSON.stringify(asked)).toBe(JSON.stringify(LMSC));
		// Changing the windows keeps the rules too.
		const edited = requestsInput({ ...values, rq_windows: "Morning 09:30-12:00" }, LMSC) as RequestsDoc;
		expect(edited.rules).toEqual(LMSC.rules);
		expect(edited.windows).toEqual([{ id: "morning", label: "Morning", start: "09:30", end: "12:00" }]);
	});

	it("T176 no stored rules: the panel adds none and shows no rules field", () => {
		const { rules: _, ...plain } = LMSC;
		expect(requestsInput(values, plain)).not.toHaveProperty("rules");
		expect(requestsInput(values, null)).not.toHaveProperty("rules");
		const ids = requestFields(LMSC).map((f) => (f as { action_id?: string }).action_id);
		expect(ids).not.toContain("rq_rules");
		// Clearing the form still removes the requests, rules and all.
		expect(requestsInput({ rq_windows: "", rq_days: "" }, LMSC)).toBeNull();
	});
});
