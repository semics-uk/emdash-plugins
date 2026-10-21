import { describe, expect, it } from "vitest";
import {
	formatInZone,
	isValidTimeZone,
	utcOffsetMinutes,
	utcToZoned,
	zonedToUtc,
} from "../src/time";

const utc = (s: string) => Date.parse(s);

describe("time zones (EV-FR-09)", () => {
	it("validates IANA names", () => {
		expect(isValidTimeZone("Europe/London")).toBe(true);
		expect(isValidTimeZone("Mars/Base")).toBe(false);
		expect(isValidTimeZone("")).toBe(false);
	});

	describe("Europe/London DST (2026-03-29 spring, 2026-10-25 autumn)", () => {
		const z = "Europe/London";
		it("offsets", () => {
			expect(utcOffsetMinutes(utc("2026-03-29T00:59:59Z"), z)).toBe(0);
			expect(utcOffsetMinutes(utc("2026-03-29T01:00:00Z"), z)).toBe(60);
			expect(utcOffsetMinutes(utc("2026-10-25T00:59:59Z"), z)).toBe(60);
			expect(utcOffsetMinutes(utc("2026-10-25T01:00:00Z"), z)).toBe(0);
		});
		it("UTC to local and back across the change", () => {
			expect(utcToZoned(utc("2026-03-29T01:00:00Z"), z)).toEqual({
				year: 2026,
				month: 3,
				day: 29,
				hour: 2,
				minute: 0,
				second: 0,
			});
			expect(zonedToUtc({ year: 2026, month: 3, day: 28, hour: 12, minute: 0 }, z)).toBe(
				utc("2026-03-28T12:00:00Z"),
			);
			expect(zonedToUtc({ year: 2026, month: 3, day: 30, hour: 12, minute: 0 }, z)).toBe(
				utc("2026-03-30T11:00:00Z"),
			);
		});
		it("nonexistent local time (gap) moves forward; ambiguous picks the first", () => {
			expect(zonedToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, z)).toBe(
				utc("2026-03-29T01:30:00Z"),
			);
			expect(zonedToUtc({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, z)).toBe(
				utc("2026-10-25T00:30:00Z"),
			);
		});
	});

	describe("America/New_York DST (2026-03-08, 2026-11-01)", () => {
		const z = "America/New_York";
		it("converts both ways", () => {
			expect(utcOffsetMinutes(utc("2026-03-08T06:59:00Z"), z)).toBe(-300);
			expect(utcOffsetMinutes(utc("2026-03-08T07:00:00Z"), z)).toBe(-240);
			expect(zonedToUtc({ year: 2026, month: 3, day: 9, hour: 9, minute: 0 }, z)).toBe(
				utc("2026-03-09T13:00:00Z"),
			);
			expect(zonedToUtc({ year: 2026, month: 11, day: 2, hour: 9, minute: 0 }, z)).toBe(
				utc("2026-11-02T14:00:00Z"),
			);
			expect(utcToZoned(utc("2026-11-01T06:00:00Z"), z).hour).toBe(1);
		});
	});

	describe("Australia/Sydney DST (southern hemisphere, 2026-04-05 ends, 2026-10-04 starts)", () => {
		const z = "Australia/Sydney";
		it("converts both ways", () => {
			expect(utcOffsetMinutes(utc("2026-04-04T00:00:00Z"), z)).toBe(660);
			expect(utcOffsetMinutes(utc("2026-04-06T00:00:00Z"), z)).toBe(600);
			expect(zonedToUtc({ year: 2026, month: 10, day: 5, hour: 9, minute: 0 }, z)).toBe(
				utc("2026-10-04T22:00:00Z"),
			);
			expect(utcToZoned(utc("2026-10-03T15:59:00Z"), z)).toMatchObject({
				day: 4,
				hour: 1,
				minute: 59,
			});
			expect(utcToZoned(utc("2026-10-03T16:00:00Z"), z)).toMatchObject({
				day: 4,
				hour: 3,
				minute: 0,
			});
		});
	});

	it("formats in a zone", () => {
		expect(
			formatInZone(utc("2026-07-01T12:00:00Z"), "Europe/London", "en-GB", {
				dateStyle: "medium",
				timeStyle: "short",
			}),
		).toBe("1 Jul 2026, 13:00");
	});

	it("throws on an invalid zone", () => {
		expect(() => utcOffsetMinutes(0, "Nope/Zone")).toThrow(RangeError);
	});
});
