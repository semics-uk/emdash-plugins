import { describe, expect, it } from "vitest";

import { approvalOf } from "../../src/domain/booking-state";
import { referenceStart } from "../../src/domain/cancel-policy";
import { parseReserveInput, planCheckout, type ReserveInput } from "../../src/domain/checkout";
import { catalogOf, validateConfigInput } from "../../src/domain/config";
import { eventInfoOf, loadEventInfo } from "../../src/domain/event-info";
import { parseRequests, requestStart, wallMs } from "../../src/domain/schedule";
import { planRefusal } from "../../src/routes/reply";
import type { EventConfigDoc, TicketTypeDoc } from "../../src/storage/schema";

// T174a: an event takes booking requests (a preferred date and a named time window) instead of a
// fixed date. The request always waits for approval; its deadline is the earlier of the approval
// window and the window's start (local time in the event's zone).

const NOW = Date.parse("2026-12-01T12:00:00.000Z"); // a Tuesday
const KEY = "k".repeat(32);
const DAY = 864e5;

const REQUESTS = {
	windows: [
		{ id: "am", label: "AM", start: "10:00", end: "12:00" },
		{ id: "pm", label: "PM", start: "12:00", end: "15:30" },
	],
	days: ["SA", "SU"],
	aheadDays: 90,
	noticeDays: 2,
	closedDates: ["2026-12-26"],
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

const config = (over: Partial<EventConfigDoc> = {}): EventConfigDoc => ({
	status: "on_sale",
	capacity: 20,
	reserved: 0,
	sold: 0,
	currency: "GBP",
	questions: [],
	signature: { required: false, mode: "each_attendee" },
	waitlistEnabled: false,
	requests: REQUESTS,
	info: { title: "Quad trek", startsAt: "2026-01-01T09:00:00.000Z", endsAt: null, timezone: "Europe/London", venue: null },
	catalog: catalogOf([{ id: "tt_a", data: tt }], []),
	...over,
});

const input = (over: Partial<ReserveInput> = {}): ReserveInput => ({
	eventId: "e1",
	lines: [{ ticketTypeId: "tt_a", qty: 2 }],
	buyer: { name: "Ada", email: "ada@example.com" },
	idempotencyKey: KEY,
	request: { date: "2026-12-12", window: "am" },
	...over,
});

const plan = (c: EventConfigDoc, i: ReserveInput, now = NOW) => planCheckout("e1", c, i, now, { maxSteps: 6 });

describe("T174a reserve input", () => {
	it("T174a accepts a request of a date and a window id, and refuses unknown keys in it", () => {
		const ok = parseReserveInput(input());
		expect(ok).toMatchObject({ ok: true, value: { request: { date: "2026-12-12", window: "am" } } });
		expect(parseReserveInput(input({ request: { date: "12/12/2026", window: "am" } })).ok).toBe(false);
		const extra = parseReserveInput({ ...input(), request: { date: "2026-12-12", window: "am", x: 1 } });
		expect(extra.ok).toBe(false);
	});
});

describe("T174a planCheckout request rules", () => {
	it("T174a plans a request for an allowed weekday, window, notice and days ahead", () => {
		expect(plan(config(), input()).ok).toBe(true);
	});

	it("T174a refuses a request when the event takes none, or one beside an occurrence", () => {
		expect(plan(config({ requests: null }), input())).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST", reason: "REQUEST_NOT_TAKEN" },
		});
		expect(plan(config(), input({ occurrenceId: "oc1" }))).toMatchObject({
			error: { code: "BAD_REQUEST", reason: "REQUEST_NOT_TAKEN" },
		});
	});

	it("T174a a request event needs a request", () => {
		expect(plan(config(), input({ request: undefined }))).toMatchObject({
			error: { code: "BAD_REQUEST", reason: "REQUEST_REQUIRED" },
		});
	});

	it("T174a refuses an unknown window", () => {
		expect(plan(config(), input({ request: { date: "2026-12-12", window: "eve" } }))).toMatchObject({
			error: { code: "BAD_REQUEST", reason: "REQUEST_WINDOW" },
		});
	});

	it("T174a refuses a wrong weekday, too little notice, too far ahead and a closed date", () => {
		const refused = (date: string, c = config()) =>
			plan(c, input({ request: { date, window: "am" } }));
		const reason = { error: { code: "BAD_REQUEST", reason: "REQUEST_DATE" } };
		expect(refused("2026-12-11")).toMatchObject(reason); // a Friday
		expect(refused("2026-12-02")).toMatchObject(reason); // a Wednesday, and too soon
		// Saturday 5 Dec is 4 days ahead: fine with 2 days' notice, refused with 5.
		expect(refused("2026-12-05").ok).toBe(true);
		expect(refused("2026-12-05", config({ requests: { ...REQUESTS, noticeDays: 5 } }))).toMatchObject(reason);
		expect(refused("2027-03-06")).toMatchObject(reason); // 95 days ahead
		expect(refused("2026-12-26")).toMatchObject(reason); // closed
		expect(refused("2026-02-30")).toMatchObject(reason); // no such day
	});

	it("T174a refuses a window that has already started today", () => {
		const c = config({ requests: { ...REQUESTS, days: ["TU"], noticeDays: 0 } });
		// 12:00 UTC on Tuesday 1 Dec: the AM window (10:00 GMT) has started; PM (12:00) is now, so it has too.
		expect(plan(c, input({ request: { date: "2026-12-01", window: "am" } }))).toMatchObject({
			error: { reason: "REQUEST_DATE" },
		});
		expect(plan(c, input({ request: { date: "2026-12-08", window: "am" } })).ok).toBe(true);
	});

	it("T174a a request refusal names the request field", () => {
		expect(planRefusal({ code: "BAD_REQUEST", reason: "REQUEST_DATE" }, "lines")).toMatchObject({
			issues: [{ path: "request", code: "REQUEST_DATE" }],
		});
	});
});

describe("T174a request config", () => {
	it("T174a parses windows, days and defaults; refuses bad windows", () => {
		expect(parseRequests({ windows: REQUESTS.windows, days: ["SA"] })).toEqual({
			windows: REQUESTS.windows,
			days: ["SA"],
			aheadDays: 90,
			noticeDays: 0,
			closedDates: [],
		});
		const bad = [
			{ windows: [], days: ["SA"] },
			{ windows: [{ id: "am", label: "AM", start: "12:00", end: "10:00" }], days: ["SA"] },
			{ windows: [REQUESTS.windows[0], REQUESTS.windows[0]], days: ["SA"] },
			{ windows: REQUESTS.windows, days: ["XX"] },
			{ windows: REQUESTS.windows, days: [] },
			{ windows: REQUESTS.windows, days: ["SA"], closedDates: ["soon"] },
		];
		for (const raw of bad) expect(parseRequests(raw), JSON.stringify(raw)).toBeNull();
	});

	it("T174a config/save keeps requests, and refuses them beside a schedule or dates", () => {
		const base = { status: "on_sale", capacity: 10, currency: "GBP" };
		const empty = { config: null, ticketTypes: new Map(), occurrences: new Map() };
		const save = (config: object, occurrences: object[] = []) =>
			validateConfigInput("e1", { eventId: "e1", config, ticketTypes: [], occurrences }, empty, () => "id1");
		const ok = save({ ...base, requests: REQUESTS });
		expect(ok.ok && ok.value.config.requests).toEqual(REQUESTS);
		const schedule = { days: ["SA"], times: ["10:00"], durationMinutes: 60, capacity: 5 };
		expect(save({ ...base, requests: REQUESTS, schedule })).toMatchObject({
			ok: false,
			error: [{ path: "config.requests", code: "INVALID_REQUESTS" }],
		});
		expect(save({ ...base, requests: REQUESTS }, [{ startsAt: "2027-01-01T10:00:00Z", capacity: 5 }])).toMatchObject({
			ok: false,
			error: [{ path: "config.requests", code: "INVALID_REQUESTS" }],
		});
	});
});

describe("T174a approval deadline of a request", () => {
	it("T174a a request needs approval even when the event's approval is off", () => {
		const c = config({ approval: { required: false, deadlineHours: 48 } });
		expect(approvalOf(c, undefined, NOW)).toEqual({});
		expect(approvalOf(c, undefined, NOW, { date: "2026-12-12", window: "am" })).toEqual({
			approval: { until: new Date(NOW + 48 * 3_600_000).toISOString() },
		});
	});

	it("T174a the deadline is the window start when that comes first", () => {
		const c = config({ approval: { required: true, deadlineHours: 720 } });
		expect(approvalOf(c, undefined, NOW, { date: "2026-12-05", window: "pm" })).toEqual({
			approval: { until: "2026-12-05T12:00:00.000Z" },
		});
	});

	it("T174a window starts are local time across the last Sunday in October (BST to GMT)", () => {
		// Clocks go back at 01:00 UTC on Sunday 25 October 2026.
		const now = Date.parse("2026-10-20T12:00:00.000Z");
		const c = config({
			approval: { required: true, deadlineHours: 720 },
			requests: { ...REQUESTS, days: ["SA", "SU", "MO"], noticeDays: 0 },
		});
		const until = (date: string) => approvalOf(c, undefined, now, { date, window: "am" }).approval?.until;
		expect(until("2026-10-24")).toBe("2026-10-24T09:00:00.000Z"); // 10:00 BST
		expect(until("2026-10-25")).toBe("2026-10-25T10:00:00.000Z"); // 10:00 GMT, the day of the change
		expect(until("2026-10-26")).toBe("2026-10-26T10:00:00.000Z"); // 10:00 GMT
		expect(wallMs("2026-10-24", "10:00", "Europe/London")).toBe(Date.parse("2026-10-24T09:00:00.000Z"));
		expect(requestStart(c, { date: "2026-10-26", window: "pm" }, now)).toBe(Date.parse("2026-10-26T12:00:00.000Z"));
		expect(wallMs("2026-13-01", "10:00", "UTC")).toBeNaN();
		expect(wallMs("2026-10-24", "25:00", "UTC")).toBeNaN();
	});

	it("T174a an approval event's requests also take the earlier of its hours and the window", () => {
		const c = config({ approval: { required: true, deadlineHours: 24 } });
		expect(approvalOf(c, undefined, NOW, { date: "2026-12-12", window: "am" })).toEqual({
			approval: { until: new Date(NOW + DAY).toISOString() },
		});
	});
});

describe("T174a agreed time", () => {
	const doc = { title: "Quad trek", startsAt: "2026-01-01T09:00:00.000Z", endsAt: "2026-01-01T11:00:00.000Z", timezone: "Europe/London", venue: "Farm" };

	it("T174a eventInfoOf takes the agreed time like an occurrence", () => {
		expect(eventInfoOf(doc, { startsAt: "2026-12-12T10:30:00.000Z", endsAt: "2026-12-12T12:00:00.000Z" })).toMatchObject({
			startsAt: Date.parse("2026-12-12T10:30:00.000Z"),
			endsAt: Date.parse("2026-12-12T12:00:00.000Z"),
		});
	});

	it("T174a loadEventInfo uses a booking's agreed time when it has no occurrence", async () => {
		const deps = {
			settings: { list: async () => [] },
			content: { get: async () => null },
			storage: {
				occurrences: { get: async () => null },
				event_configs: { get: async () => ({ info: doc }) },
			},
		};
		const got = await loadEventInfo(deps, "e1", undefined, { time: { startsAt: "2026-12-12T10:30:00.000Z" } });
		expect(got?.startsAt).toBe(Date.parse("2026-12-12T10:30:00.000Z"));
	});

	it("T174a self-service cancel counts from the agreed time", () => {
		expect(referenceStart({ time: { startsAt: "2026-12-12T10:30:00.000Z" } }, { catalog: null })).toBe(
			Date.parse("2026-12-12T10:30:00.000Z"),
		);
	});
});
