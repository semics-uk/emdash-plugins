import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine } from "../src/ics";
import { zonedToUtc } from "../src/time";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const octets = (s: string) => new TextEncoder().encode(s).length;
const unfold = (s: string) => s.replace(/\r\n /g, "");

describe("ICS (RFC 5545) (EV-FR-09)", () => {
	it("escapes TEXT per 3.3.11", () => {
		expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
		expect(escapeText("x\r\ny")).toBe("x\\ny");
	});

	it("folds lines to 75 octets with a leading space, never splitting UTF-8", () => {
		expect(foldLine("short")).toBe("short");
		const long = `DESCRIPTION:${"a".repeat(200)}`;
		const lines = foldLine(long).split("\r\n");
		for (const l of lines) expect(octets(l)).toBeLessThanOrEqual(75);
		for (const l of lines.slice(1)) expect(l.startsWith(" ")).toBe(true);
		expect(unfold(foldLine(long))).toBe(long);
		const wide = `SUMMARY:${"é€😀".repeat(40)}`;
		for (const l of foldLine(wide).split("\r\n")) expect(octets(l)).toBeLessThanOrEqual(75);
		expect(unfold(foldLine(wide))).toBe(wide);
	});

	const base = {
		uid: "evt-1@example.com",
		stamp: Date.UTC(2026, 0, 1, 9, 0, 0),
		summary: "Pottery, class; level 1",
		description: "Bring an apron.\nSecond line",
		location: "Studio 4, High St",
		url: "https://example.com/e/1",
	};

	it("matches the snapshot for a zoned event (TZID + VTIMEZONE across DST)", () => {
		const start = zonedToUtc({ year: 2026, month: 3, day: 28, hour: 18, minute: 0 }, "Europe/London");
		const ics = buildCalendar({
			prodId: "-//semics//events//EN",
			events: [
				{
					...base,
					start,
					end: start + 2 * 3600_000,
					timeZone: "Europe/London",
					rrule: "FREQ=WEEKLY;COUNT=4",
				},
			],
		});
		expect(ics).toBe(fixture("london-event.ics"));
		expect(ics).toContain("DTSTART;TZID=Europe/London:20260328T180000\r\n");
		expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/London");
	});

	it("matches the snapshot for a UTC event and CANCEL method", () => {
		const ics = buildCalendar({
			prodId: "-//semics//events//EN",
			method: "CANCEL",
			events: [
				{
					...base,
					start: Date.UTC(2026, 6, 1, 10),
					end: Date.UTC(2026, 6, 1, 11),
					status: "CANCELLED",
					sequence: 2,
				},
			],
		});
		expect(ics).toBe(fixture("utc-event.ics"));
	});

	it("is structurally valid: CRLF, folded, balanced, required properties", () => {
		const ics = buildCalendar({
			prodId: "-//x//y//EN",
			events: [{ ...base, summary: "x".repeat(300), start: 0, end: 3600_000 }],
		});
		expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
		expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
		for (const l of ics.split("\r\n")) expect(octets(l)).toBeLessThanOrEqual(75);
		expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//y//EN\r\n")).toBe(true);
		for (const p of ["UID:", "DTSTAMP:", "DTSTART:19700101T000000Z", "DTEND:19700101T010000Z"])
			expect(ics).toContain(p);
	});

	it("supports all-day events and rejects bad input", () => {
		const ics = buildCalendar({
			prodId: "p",
			events: [
				{ uid: "a", stamp: 0, summary: "s", start: Date.UTC(2026, 4, 1), end: Date.UTC(2026, 4, 2), allDay: true },
			],
		});
		expect(ics).toContain("DTSTART;VALUE=DATE:20260501\r\n");
		expect(ics).toContain("DTEND;VALUE=DATE:20260502\r\n");
		expect(() =>
			buildCalendar({ prodId: "p", events: [{ uid: "a", stamp: 0, summary: "s", start: 5, end: 1 }] }),
		).toThrow(RangeError);
		expect(() =>
			buildCalendar({
				prodId: "p",
				events: [{ uid: "a", stamp: 0, summary: "s", start: 0, end: 1, timeZone: "No/Where" }],
			}),
		).toThrow(RangeError);
	});
});
