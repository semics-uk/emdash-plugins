/**
 * A small RRULE subset (RFC 5545 §3.3.10) for recurring events (EV-FR-17, T084). Pure, Web APIs only.
 *
 * Supported: `FREQ` DAILY, WEEKLY or MONTHLY; `INTERVAL`; `BYDAY` (with an ordinal such as `1MO` or
 * `-1FR` only when MONTHLY); `BYMONTHDAY` (DAILY and MONTHLY; negative counts from the month's end);
 * `COUNT` or `UNTIL` (not both); and one extension, `EXDATE=20261224,20261231`: local dates to skip.
 * Weeks start on Monday (`WKST` is not supported). Anything else is refused, so a rule never means
 * something other than what was typed.
 *
 * Semantics follow python-dateutil's `rrule`, the reference the test vectors come from
 * (`tests/fixtures/rrule/generate.py`): the series starts at `DTSTART`, but `DTSTART` is an
 * occurrence only when it matches the rule; `COUNT` counts occurrences before `EXDATE` removes any;
 * `UNTIL` is inclusive (a date alone means the end of that local day).
 *
 * Expansion runs on wall-clock time ("naive" milliseconds: the local time read as UTC), so every
 * occurrence keeps the local time of `DTSTART` across daylight-saving changes; `zonedToUtc` then
 * makes each an instant (a skipped local time moves forward by the gap, a repeated one takes the
 * first instant).
 */
import { utcToZoned, zonedToUtc } from "./time";

export interface Rrule {
	freq: "DAILY" | "WEEKLY" | "MONTHLY";
	interval: number;
	/** `[ordinal, weekday]`: weekday 0 = Monday; ordinal 0 = every such weekday. */
	byDay?: Array<[number, number]>;
	byMonthDay?: number[];
	count?: number;
	/** `YYYYMMDD` (local, the whole day) or `YYYYMMDDTHHMMSSZ` (UTC). */
	until?: string;
	/** Local dates (`YYYYMMDD`) left out of the series. */
	exDates: string[];
}

const DAY = 864e5;
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
/** Periods (days, weeks or months) one expansion looks at, whatever the rule: a CPU bound. */
const MAX_PERIODS = 4000;

/** A whole number in `[min, max]` (digits, optional sign), else NaN. */
const int = (s: string, min: number, max: number) => {
	const n = /^[+-]?\d{1,4}$/.test(s) ? Number(s) : Number.NaN;
	return n >= min && n <= max ? n : Number.NaN;
};

/** Naive milliseconds of a `YYYYMMDD` date (NaN unless it is a real calendar day). */
function dayOf(s: string): number {
	const t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
	return t >= 0 && dayStamp(t) === s.slice(0, 8) ? t : Number.NaN;
}

/** `YYYYMMDD` of naive milliseconds. */
export const dayStamp = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/** Parse a rule (an `RRULE:` prefix is allowed); null when it is malformed or outside the subset. */
export function parseRrule(text: string): Rrule | null {
	if (typeof text !== "string" || text.length > 500) return null;
	const rule: Rrule = { freq: "DAILY", interval: 1, exDates: [] };
	const seen = new Set<string>();
	for (const part of text
		.trim()
		.replace(/^RRULE:/i, "")
		.toUpperCase()
		.split(";")) {
		const [k = "", v = "", extra] = part.split("=").map((s) => s.trim());
		if (extra !== undefined || !v || seen.has(k)) return null;
		seen.add(k);
		const list = v.split(",");
		if (k === "FREQ" && /^(DAILY|WEEKLY|MONTHLY)$/.test(v)) rule.freq = v as Rrule["freq"];
		else if (k === "INTERVAL") rule.interval = int(v, 1, 999);
		else if (k === "COUNT") rule.count = int(v, 1, 1000);
		else if (k === "UNTIL" && /^\d{8}(T\d{6}Z)?$/.test(v) && dayOf(v) >= 0) rule.until = v;
		else if (k === "EXDATE" && list.every((d) => d.length === 8 && dayOf(d) >= 0)) rule.exDates = list;
		else if (k === "BYMONTHDAY") rule.byMonthDay = list.map((d) => int(d, -31, 31) || Number.NaN);
		else if (k === "BYDAY") {
			rule.byDay = list.map((d) => {
				const m = /^([+-]?\d)?(\w\w)$/.exec(d);
				const w = WEEKDAYS.indexOf(m?.[2] as string);
				return [w < 0 ? Number.NaN : m?.[1] ? int(m[1], -5, 5) || Number.NaN : 0, w];
			});
		} else return null;
	}
	const ok =
		seen.has("FREQ") &&
		![rule.interval, rule.count, ...(rule.byMonthDay ?? []), ...(rule.byDay ?? []).flat()].some(Number.isNaN) &&
		!(rule.count && rule.until) &&
		(rule.freq === "MONTHLY" || !rule.byDay?.some(([n]) => n)) &&
		!(rule.freq === "WEEKLY" && rule.byMonthDay);
	return ok ? rule : null;
}

/** Monday = 0. */
const weekday = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7;
const monthDays = (ms: number) => {
	const d = new Date(ms);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

/**
 * The occurrences of `rule` from `start`, as naive milliseconds, between `from` and `to` inclusive,
 * at most `max`; `until` is `UNTIL` in naive milliseconds. Pure arithmetic: no time zones.
 */
export function expandLocal(rule: Rrule, start: number, from: number, to: number, max: number, until = to) {
	const out: number[] = [];
	const time = ((start % DAY) + DAY) % DAY;
	const day0 = start - time;
	const first = new Date(day0);
	const [w0, d0] = [weekday(day0), first.getUTCDate()];
	const { freq, interval, byDay, byMonthDay, count } = rule;
	// Without COUNT the periods before the window cannot matter: start one period early.
	const months = (a: Date, b: Date) =>
		(b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
	const span = freq === "MONTHLY" ? 0 : (freq === "WEEKLY" ? 7 : 1) * interval * DAY;
	const skip =
		count || from <= day0
			? 0
			: Math.max(Math.floor((span ? (from - day0) / span : months(first, new Date(from)) / interval) - 1), 0);
	let n = 0;
	for (let k = skip; k < skip + MAX_PERIODS; k++) {
		// Period k: one day, the Monday-first week, or the month.
		const step = k * interval;
		const begin =
			freq === "DAILY"
				? day0 + step * DAY
				: freq === "WEEKLY"
					? day0 - w0 * DAY + step * 7 * DAY
					: Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + step, 1);
		if (begin + time > Math.min(to, until)) break;
		const days = freq === "DAILY" ? 1 : freq === "WEEKLY" ? 7 : monthDays(begin);
		for (let i = 0; i < days; i++) {
			const day = begin + i * DAY;
			const d = new Date(day).getUTCDate();
			const w = weekday(day);
			const len = monthDays(day);
			const hit =
				day >= day0 &&
				(!byMonthDay || byMonthDay.some((md) => md === d || md === d - len - 1)) &&
				(byDay
					? byDay.some(
							([o, wd]) => wd === w && (!o || (o > 0 ? Math.ceil(d / 7) : -Math.ceil((len - d + 1) / 7)) === o),
						)
					: freq !== "WEEKLY" || w === w0) &&
				(freq !== "MONTHLY" || byDay || byMonthDay || d === d0);
			if (!hit) continue;
			const at = day + time;
			if (at > to || at > until) return out;
			n++;
			if (at >= from && !rule.exDates.includes(dayStamp(day))) {
				if (out.push(at) >= max) return out;
			}
			if (n === count) return out;
		}
	}
	return out;
}

/** Wall-clock parts of naive milliseconds. */
const parts = (t: number) => {
	const d = new Date(t);
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
		second: d.getUTCSeconds(),
	};
};

/**
 * The instants (UTC ms) of the series that starts at `startUtc` in `zone`, between `fromUtc` and
 * `toUtc` inclusive, at most `max`; each at the local time of `startUtc`.
 */
export function occurrencesBetween(
	rule: Rrule,
	startUtc: number,
	zone: string,
	fromUtc: number,
	toUtc: number,
	max: number,
): number[] {
	const naive = (utc: number) => {
		const p = utcToZoned(utc, zone);
		return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	};
	const u = rule.until;
	const until = !u
		? undefined
		: u.length === 8
			? dayOf(u) + DAY - 1
			: naive(
					Date.UTC(
						+u.slice(0, 4),
						+u.slice(4, 6) - 1,
						+u.slice(6, 8),
						+u.slice(9, 11),
						+u.slice(11, 13),
						+u.slice(13, 15),
					),
				);
	// A day of slack each side; the window is cut exactly once the instants are known.
	return expandLocal(rule, naive(startUtc), naive(fromUtc) - DAY, naive(toUtc) + DAY, max + 2, until)
		.map((t) => zonedToUtc(parts(t), zone))
		.filter((t) => t >= fromUtc && t <= toUtc)
		.slice(0, max);
}
