/**
 * The booking form's day-then-time picker (T130, EV-FR-17): pure helpers for `<BookingWidget>`.
 *
 * An event with a slot schedule, or with more than one start on a local day, is booked by picking a
 * day on a month calendar, then one of that day's times. The page renders both the calendar and, for
 * visitors without JavaScript, a plain `<select>` of the same month's dates grouped by day
 * (`<optgroup>`); `src/client/picker.ts` swaps one for the other. Days are the event's local days
 * (`timezone`, else UTC), so a slot at 23:30 in New York sits on that evening's day, and both runs of a
 * repeated DST hour stay on their day.
 *
 * Paging: `public/event` answers up to 200 upcoming open slots from `from` (closed ones never), with
 * `more` when there are further ones. The widget shows one month, starting at the `booking_from` query
 * parameter (a local `YYYY-MM-DD`, today when absent or past); it asks the core from that day's earliest
 * possible local midnight (UTC+14) and skips what falls before the day. A truncated answer's last day
 * may be partial, so it is left for the next page, which starts on it.
 */
import { translator } from "../../i18n/index";
import { WIDGET_PARAMS } from "./widget";

/** The query parameter holding the first local day the picker shows. */
export const PICKER_PARAM = "booking_from";

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR = 3_600_000;
/** The earliest a local midnight can be, relative to UTC midnight of the same date (UTC+14). */
const EARLIEST_OFFSET = 14 * HOUR;

export interface PickerOccurrence {
	id: string;
	startsAt: string;
	endsAt?: string | null;
	available?: number | null;
}

export interface PickerSlot {
	id: string;
	/** The start's local time (`09:30`). */
	time: string;
	/** "3 places left" or "Full"; empty when the core does not say. */
	places: string;
	full: boolean;
	/** What a screen reader hears: time and places. */
	label: string;
}

export interface PickerDay {
	/** The local day, `YYYY-MM-DD`. */
	key: string;
	/** Day of the month. */
	day: number;
	/** The full date ("Wednesday 4 November 2026"). */
	label: string;
	/** The day button's accessible name: the date, plus "fully booked" when no slot has room. */
	buttonLabel: string;
	slots: PickerSlot[];
	/** Some slot has room. */
	open: boolean;
}

/** A calendar cell: a day of the month (with no slots: `slots` is empty), or `null` before/after it. */
export type PickerCell = PickerDay | null;

export interface PickerView {
	month: { key: string; label: string };
	weekdays: Array<{ short: string; long: string }>;
	/** Weeks of seven cells, Monday first. */
	weeks: PickerCell[][];
	/** The month's days that have slots, earliest first. */
	days: PickerDay[];
	/** The day button that takes focus first (roving tabindex): the first open day, else the first day. */
	focusDay?: string;
	/** `booking_from` values for the earlier and later pages. */
	prev?: string;
	next?: string;
}

function formatter(locale: string, zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	try {
		return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
	} catch {
		return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
	}
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day (`YYYY-MM-DD`) of an instant in a zone (UTC for an unknown zone). */
export function localDay(ms: number, zone: string): string {
	const parts = formatter("en-US", zone, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return `${get("year")}-${pad(get("month"))}-${pad(get("day"))}`;
}

/** A real calendar date `YYYY-MM-DD` as UTC midnight (ms), else `null`. */
function dayMs(key: string | null | undefined): number | null {
	const m = DAY_KEY.exec(key ?? "");
	if (!m) return null;
	const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return new Date(ms).toISOString().slice(0, 10) === key ? ms : null;
}

const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const monthFirst = (month: string, delta = 0) => {
	const [y, m] = month.split("-").map(Number) as [number, number];
	return keyOf(Date.UTC(y, m - 1 + delta, 1));
};

/** Whether the form books through the picker: a slot schedule, or two starts on one local day. */
export function usesPicker(
	event: { occurrences?: PickerOccurrence[]; slots?: boolean; timezone?: string } | undefined,
	zone = event?.timezone ?? "UTC",
): boolean {
	if (!event) return false;
	if (event.slots === true) return true;
	const seen = new Set<string>();
	for (const o of event.occurrences ?? []) {
		const day = localDay(Date.parse(o.startsAt), zone);
		if (seen.has(day)) return true;
		seen.add(day);
	}
	return false;
}

/** The occurrences grouped by local day, earliest first, with their times and places left. */
export function groupByDay(occurrences: readonly PickerOccurrence[], zone: string, locale: string): PickerDay[] {
	const { t, plural } = translator(locale);
	const time = formatter(locale, zone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
	const date = formatter(locale, "UTC", { dateStyle: "full" });
	const days = new Map<string, PickerDay>();
	const sorted = occurrences
		.map((o) => ({ o, ms: Date.parse(o.startsAt) }))
		.filter(({ ms }) => Number.isFinite(ms))
		.sort((a, b) => a.ms - b.ms);
	for (const { o, ms } of sorted) {
		const key = localDay(ms, zone);
		let day = days.get(key);
		if (!day) {
			const label = date.format(dayMs(key) ?? ms);
			day = { key, day: Number(key.slice(8)), label, buttonLabel: label, slots: [], open: false };
			days.set(key, day);
		}
		const known = typeof o.available === "number";
		const full = known && (o.available as number) <= 0;
		const places = !known ? "" : full ? t("widget.picker.full") : plural("widget.picker.left", o.available as number);
		const at = time.format(ms);
		day.slots.push({ id: o.id, time: at, places, full, label: places ? `${at}, ${places}` : at });
		if (!full) day.open = true;
	}
	for (const day of days.values()) {
		if (!day.open) day.buttonLabel = t("widget.picker.dayFull", { date: day.label });
	}
	return [...days.values()];
}

/** The `from` to ask `public/event` for, for a `booking_from` day: its earliest possible local midnight. */
export function pickerFetchFrom(start: string | null | undefined): string | undefined {
	const ms = dayMs(start);
	return ms === null ? undefined : new Date(ms - EARLIEST_OFFSET).toISOString();
}

/** A link to another page of the picker: the current page's query without widget errors, and the anchor. */
export function pickerHref(url: URL, start: string, anchor: string): string {
	const next = new URL(url.href);
	for (const name of Object.values(WIDGET_PARAMS)) next.searchParams.delete(name);
	next.searchParams.set(PICKER_PARAM, start);
	return `${next.pathname}${next.search}#${anchor}`;
}

export interface PickerOptions {
	zone: string;
	locale: string;
	/** The `booking_from` parameter (a local `YYYY-MM-DD`), if any. */
	start: string | null | undefined;
	now: number;
	/** `public/event` said there are more slots after the ones it sent. */
	more?: boolean;
}

/** One month of the picker: its calendar, its days with slots, and the paging links. */
export function pickerView(occurrences: readonly PickerOccurrence[], opts: PickerOptions): PickerView {
	const today = localDay(opts.now, opts.zone);
	const asked = dayMs(opts.start) === null ? today : (opts.start as string);
	const start = asked > today ? asked : today;
	const startMonth = start.slice(0, 7);

	const grouped = groupByDay(occurrences, opts.zone, opts.locale).filter((d) => d.key >= start);
	const partial = opts.more && grouped.length > 1 ? grouped.pop() : undefined;
	const month = grouped.some((d) => d.key.startsWith(startMonth))
		? startMonth
		: (grouped[0]?.key.slice(0, 7) ?? startMonth);
	const days = grouped.filter((d) => d.key.startsWith(month));
	const following = monthFirst(month, 1);

	let next: string | undefined;
	if (partial?.key.startsWith(month)) next = partial.key;
	else if (partial || grouped.some((d) => d.key >= following)) next = following;

	let prev: string | undefined;
	if (start > today) {
		const back = start > monthFirst(startMonth) ? monthFirst(startMonth) : monthFirst(startMonth, -1);
		prev = back > today ? back : today;
	}

	const [y, m] = month.split("-").map(Number) as [number, number];
	const first = Date.UTC(y, m - 1, 1);
	const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const byDay = new Map(days.map((d) => [d.day, d]));
	const date = formatter(opts.locale, "UTC", { dateStyle: "full" });
	const cells: PickerCell[] = Array.from({ length: (new Date(first).getUTCDay() + 6) % 7 }, () => null);
	for (let d = 1; d <= length; d++) {
		const key = `${month}-${pad(d)}`;
		const label = date.format(Date.UTC(y, m - 1, d));
		cells.push(byDay.get(d) ?? { key, day: d, label, buttonLabel: label, slots: [], open: false });
	}
	while (cells.length % 7 !== 0) cells.push(null);
	const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

	const short = formatter(opts.locale, "UTC", { weekday: "short" });
	const long = formatter(opts.locale, "UTC", { weekday: "long" });
	// 5 January 2026 is a Monday.
	const weekdays = Array.from({ length: 7 }, (_, i) => {
		const ms = Date.UTC(2026, 0, 5 + i);
		return { short: short.format(ms), long: long.format(ms) };
	});

	return {
		month: { key: month, label: formatter(opts.locale, "UTC", { month: "long", year: "numeric" }).format(first) },
		weekdays,
		weeks,
		days,
		...((days.find((d) => d.open) ?? days[0]) ? { focusDay: (days.find((d) => d.open) ?? days[0])?.key } : {}),
		...(prev ? { prev } : {}),
		...(next ? { next } : {}),
	};
}
