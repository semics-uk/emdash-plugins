import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandLocal, occurrencesBetween, parseRrule, type Rrule } from "../src/rrule";
import { utcToZoned } from "../src/time";

interface Vector {
	rule: string;
	start: string;
	zone: string;
	from: string;
	to: string;
	expected: string[];
}

const { generator, vectors } = JSON.parse(
	readFileSync(new URL("./fixtures/rrule/vectors.json", import.meta.url), "utf8"),
) as { generator: string; vectors: Vector[] };

const iso = (ms: number) => new Date(ms).toISOString();
const rule = (text: string) => {
	const r = parseRrule(text);
	if (!r) throw new Error(`refused: ${text}`);
	return r;
};

describe(`RRULE expansion (EV-FR-17, reference: ${generator})`, () => {
	it.each(vectors)("EV-FR-17 RRULE vectors match a reference expansion: $rule from $start in $zone", (v) => {
		const got = occurrencesBetween(
			rule(v.rule),
			Date.parse(v.start),
			v.zone,
			Date.parse(v.from),
			Date.parse(v.to),
			1000,
		);
		expect(got.map(iso)).toEqual(v.expected);
	});

	it("EV-FR-17 DST transitions keep local times (Europe/London, March and October 2026)", () => {
		const zone = "Europe/London";
		const spring = occurrencesBetween(
			rule("FREQ=WEEKLY;COUNT=4"),
			Date.parse("2026-03-15T19:30:00Z"),
			zone,
			Date.parse("2026-03-01T00:00:00Z"),
			Date.parse("2026-12-31T00:00:00Z"),
			10,
		);
		const autumn = occurrencesBetween(
			rule("FREQ=DAILY;COUNT=3"),
			Date.parse("2026-10-24T18:30:00Z"),
			zone,
			Date.parse("2026-10-01T00:00:00Z"),
			Date.parse("2026-12-31T00:00:00Z"),
			10,
		);
		for (const t of [...spring, ...autumn]) {
			const local = utcToZoned(t, zone);
			expect([local.hour, local.minute]).toEqual([19, 30]);
		}
		// The instants move by the hour the clocks did.
		expect(spring.map(iso)).toEqual([
			"2026-03-15T19:30:00.000Z",
			"2026-03-22T19:30:00.000Z",
			"2026-03-29T18:30:00.000Z",
			"2026-04-05T18:30:00.000Z",
		]);
		expect(autumn.map(iso)).toEqual([
			"2026-10-24T18:30:00.000Z",
			"2026-10-25T19:30:00.000Z",
			"2026-10-26T19:30:00.000Z",
		]);
	});

	it("EV-FR-17 a skipped local time moves forward by the gap; a repeated one takes its first instant", () => {
		const zone = "Europe/London";
		const at = (start: string) =>
			occurrencesBetween(
				rule("FREQ=DAILY;COUNT=2"),
				Date.parse(start),
				zone,
				0,
				Date.parse("2027-01-01T00:00:00Z"),
				5,
			).map(iso);
		// 01:30 does not exist on 29 March: it is read as 01:30 GMT (02:30 BST).
		expect(at("2026-03-28T01:30:00Z")).toEqual(["2026-03-28T01:30:00.000Z", "2026-03-29T01:30:00.000Z"]);
		// 01:30 happens twice on 25 October: the first (BST) one.
		expect(at("2026-10-24T00:30:00Z")).toEqual(["2026-10-24T00:30:00.000Z", "2026-10-25T00:30:00.000Z"]);
	});

	it("EV-FR-17 expansion never returns more than it is asked for, and stops at the window", () => {
		const daily = rule("FREQ=DAILY");
		const start = Date.UTC(2026, 0, 1, 9);
		expect(expandLocal(daily, start, start, start + 365 * 864e5, 7)).toHaveLength(7);
		expect(expandLocal(daily, start, start, start + 2 * 864e5, 100)).toHaveLength(3);
		expect(occurrencesBetween(daily, start, "UTC", start, start + 365 * 864e5, 5)).toHaveLength(5);
		// A rule that matches nothing ends within its period bound instead of scanning forever.
		const nothing: Rrule = { freq: "MONTHLY", interval: 1, byMonthDay: [31], byDay: [[1, 0]], exDates: [] };
		expect(expandLocal(nothing, start, start, Number.MAX_SAFE_INTEGER, 5)).toEqual([]);
	});

	it("EV-FR-17 a window late in a long series does not count periods it skips (no COUNT)", () => {
		const start = Date.UTC(2015, 0, 1, 9);
		const from = Date.UTC(2026, 5, 1);
		const to = Date.UTC(2026, 5, 7, 23);
		expect(expandLocal(rule("FREQ=DAILY"), start, from, to, 50).map(iso)).toEqual(
			[1, 2, 3, 4, 5, 6, 7].map((d) => iso(Date.UTC(2026, 5, d, 9))),
		);
		expect(
			expandLocal(rule("FREQ=MONTHLY;INTERVAL=5"), start, Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1), 50).map(iso),
		).toEqual([iso(Date.UTC(2026, 3, 1, 9)), iso(Date.UTC(2026, 8, 1, 9))]);
	});
});

describe("RRULE parsing (EV-FR-17)", () => {
	it("EV-FR-17 reads the subset, with an RRULE: prefix and in any case", () => {
		expect(parseRrule("RRULE:freq=weekly;byday=mo,fr;interval=2")).toEqual({
			freq: "WEEKLY",
			interval: 2,
			byDay: [
				[0, 0],
				[0, 4],
			],
			exDates: [],
		});
		expect(parseRrule("FREQ=MONTHLY;BYDAY=-1FR,2TU;BYMONTHDAY=-1,15;UNTIL=20271231T120000Z;EXDATE=20261225")).toEqual({
			freq: "MONTHLY",
			interval: 1,
			byDay: [
				[-1, 4],
				[2, 1],
			],
			byMonthDay: [-1, 15],
			until: "20271231T120000Z",
			exDates: ["20261225"],
		});
		expect(parseRrule("FREQ=DAILY;COUNT=1000")).toMatchObject({ count: 1000 });
	});

	it.each([
		"",
		"COUNT=3",
		"FREQ=YEARLY",
		"FREQ=HOURLY;COUNT=2",
		"FREQ=DAILY;FREQ=WEEKLY",
		"FREQ=DAILY;COUNT=0",
		"FREQ=DAILY;COUNT=1001",
		"FREQ=DAILY;INTERVAL=0",
		"FREQ=DAILY;INTERVAL=x",
		"FREQ=DAILY;COUNT=3;UNTIL=20261231",
		"FREQ=DAILY;UNTIL=20261301",
		"FREQ=DAILY;UNTIL=20260230",
		"FREQ=DAILY;UNTIL=20261231T120000",
		"FREQ=DAILY;EXDATE=2026-12-25",
		"FREQ=DAILY;EXDATE=20261232",
		"FREQ=WEEKLY;BYDAY=1MO",
		"FREQ=DAILY;BYDAY=-1FR",
		"FREQ=WEEKLY;BYMONTHDAY=1",
		"FREQ=MONTHLY;BYDAY=0MO",
		"FREQ=MONTHLY;BYDAY=6MO",
		"FREQ=MONTHLY;BYDAY=1XX",
		"FREQ=MONTHLY;BYDAY=XX",
		"FREQ=MONTHLY;BYMONTHDAY=0",
		"FREQ=MONTHLY;BYMONTHDAY=32",
		"FREQ=DAILY;WKST=SU",
		"FREQ=DAILY;COUNT=2=3",
		"FREQ=DAILY;COUNT",
		`FREQ=DAILY;EXDATE=${"20261225,".repeat(60)}20261225`,
	])("EV-FR-17 refuses %j", (text) => {
		expect(parseRrule(text)).toBeNull();
	});

	it("EV-FR-17 refuses what is not text", () => {
		expect(parseRrule(42 as unknown as string)).toBeNull();
	});
});
