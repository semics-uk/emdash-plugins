/**
 * Slot schedules (EV-FR-17, T129, R94): one central schedule on the event config gives many bookable
 * slots a day (`config.schedule`: weekdays x `HH:MM` times, local to `info.timezone`, each slot
 * `durationMinutes` long with `capacity` places, kept `bookAheadDays` ahead, never on `closedDates`).
 * Pure: validation, slot generation and the plan the `occurrences` cron works from the config alone.
 *
 * Slots are ordinary occurrences with ids `s-<eventId>-<start in base 36>`. An event with a schedule,
 * or with slots made by one, is schedule-owned: `config/save` leaves its occurrences to this module.
 * DST: a slot time that does not exist that day is skipped; a repeated one takes the first instant.
 */
import { utcOffsetMinutes, utcParts, utcToZoned, validZone, WEEKDAYS, zonedToUtc } from "@semics-tech/shared";

import type {
	BookingDoc,
	EventConfigDoc,
	RequestRule,
	RequestsDoc,
	RequestWindow,
	ScheduleDoc,
} from "../storage/schema";
import { isArr, isInt, isStr, keysOf } from "./names";
import { msOf } from "./time";

export type { ScheduleDoc };

const DAY = 864e5;
export const DAYS = WEEKDAYS;
/** Slots a schedule keeps ahead (6 a day for 13 weeks fit): bounds the catalog (R24) and the cron's CPU. */
export const MAX_SLOTS = 600;
/** Slots one cron tick creates (one `putMany`). */
export const SLOT_BATCH = 50;
/** An unlisted slot is deleted only this long after it left the catalog (in-flight checkouts land first). */
const GRACE = 5 * 60_000;
/** Past slots leave the catalog this long after they start; their documents stay. */
const PRUNE = 7 * DAY;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const int = (v: unknown, min: number, max: number) => isInt(v) && (v as number) >= min && (v as number) <= max;
const list = (v: unknown, max: number, ok: (s: string) => boolean) =>
	isArr(v) && v.length <= max && new Set(v).size === v.length && v.every((s) => isStr(s) && ok(s));

/** Naive (local-as-UTC) ms of a real `YYYY-MM-DD`, else NaN. */
const dayMs = (d: string) => {
	const t = DATE.test(d) ? msOf(d) : Number.NaN;
	return t >= 0 && new Date(t).toISOString().startsWith(d) ? t : Number.NaN;
};
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
/** The weekday (`MO`..`SU`) of a naive day's ms. */
const weekday = (t: number) => DAYS[(new Date(t).getUTCDay() + 6) % 7] as string;

/** The instant of local `HH:MM` on local `YYYY-MM-DD` in the zone (DST like `zonedToUtc`), else NaN. */
export const wallMs = (day: string, time: string, zone: string): number => {
	const t = dayMs(day) + mins(time) * 6e4;
	return TIME.test(time) && t >= 0 ? zonedToUtc(utcParts(t), zone) : Number.NaN;
};

/** Weekdays (at least one), 1 to `max` days ahead and closed local dates: schedules' and requests' (T174a). */
const weekdays = (days: unknown) => list(days, 7, (d) => DAYS.includes(d)) && (days as string[]).length;
const dated = (days: unknown, ahead: unknown, max: number, closed: unknown) =>
	weekdays(days) &&
	int(ahead, 1, max) &&
	isArr(closed) &&
	closed.length <= 366 &&
	closed.every((d) => isStr(d) && dayMs(d) >= 0);

/** A valid schedule (times sorted, defaults filled), or null. */
export function parseSchedule(raw: unknown): ScheduleDoc | null {
	const s = (raw ?? 0) as Record<string, unknown>;
	const ahead = s.bookAheadDays ?? 56;
	const closed = s.closedDates ?? [];
	const ok =
		typeof raw === "object" &&
		list(s.times, 24, (t) => TIME.test(t)) &&
		(s.times as string[]).length &&
		int(s.durationMinutes, 1, 1440) &&
		int(s.capacity, 1, 1e6) &&
		dated(s.days, ahead, 90, closed);
	return ok
		? {
				days: s.days as string[],
				times: [...(s.times as string[])].sort(),
				durationMinutes: s.durationMinutes as number,
				capacity: s.capacity as number,
				bookAheadDays: ahead as number,
				closedDates: closed as string[],
			}
		: null;
}

export const slotId = (eventId: string, t: number) => `s-${eventId}-${t.toString(36)}`;

/** Instants (UTC ms) of the schedule's slots from `now` to `bookAheadDays` ahead, earliest first, at most MAX_SLOTS. */
export function slotStarts(s: ScheduleDoc, zone: string, now: number): number[] {
	const p = utcToZoned(now, zone);
	const first = Date.UTC(p.year, p.month - 1, p.day);
	const end = now + s.bookAheadDays * DAY;
	// The zone's offset at local noon of each day (one Intl call a day): a day whose neighbours agree has no change.
	const off = (i: number) => utcOffsetMinutes(first + i * DAY + DAY / 2, zone);
	const offs = [off(-1), off(0)];
	const out: number[] = [];
	for (let i = 0; i <= s.bookAheadDays; i++) {
		offs.push(off(i + 1));
		const day = first + i * DAY;
		const stamp = new Date(day).toISOString().slice(0, 10);
		if (!s.days.includes(weekday(day)) || s.closedDates.includes(stamp)) continue;
		const [a, b] = [offs[i] as number, offs[i + 2] as number];
		for (const time of s.times) {
			const w = day + mins(time) * 60_000;
			// Each offset in force around the day gives a candidate; a valid one maps back to the same wall time.
			const at = Math.min(
				...(a === b ? [a] : [a, b])
					.map((o) => w - o * 60_000)
					.filter((t) => a === b || utcOffsetMinutes(t, zone) * 60_000 === w - t),
			);
			if (at >= now && at <= end) out.push(at);
		}
	}
	return out.sort((x, y) => x - y).slice(0, MAX_SLOTS);
}

/** `[start, end)` instants of the local day `YYYY-MM-DD` in the zone, or null for a bad date. */
export function dayBounds(day: string, zone: string): [number, number] | null {
	const t = dayMs(day);
	if (!(t >= 0)) return null;
	const at = (ms: number) => zonedToUtc(utcParts(ms), zone);
	return [at(t), at(t + DAY)];
}

/** 1 to 8 windows of exactly id, label, start and end (stored as given). */
const windowsOk = (w: unknown) =>
	isArr(w) &&
	w[0] &&
	!w[8] &&
	w.every(
		(x) =>
			keysOf(x ?? 0).length === 4 &&
			isStr(x.id) &&
			/^[a-z0-9-]{1,32}$/.test(x.id) &&
			isStr(x.label) &&
			x.label.length <= 40 &&
			TIME.test(x.start) &&
			TIME.test(x.end) &&
			x.end > x.start,
	);
const RULE_KEYS = ["days", "from", "to", "summer", "windows"];

/** Valid booking requests (T174a; defaults filled; T176 rules), or null. */
export function parseRequests(raw: unknown): RequestsDoc | null {
	const r = (raw ?? 0) as Record<string, unknown>;
	const ahead = r.aheadDays ?? 90;
	const notice = r.noticeDays ?? 0;
	const closed = r.closedDates ?? [];
	const rules = (r.rules ?? []) as RequestRule[];
	const ok =
		windowsOk(r.windows) &&
		isArr(rules) &&
		!rules[10] &&
		rules.every(
			(x) =>
				windowsOk(x?.windows) &&
				keysOf(x).every((k) => RULE_KEYS.includes(k)) &&
				(x.days === undefined || weekdays(x.days)) &&
				// `MM-DD` (29 Feb too): a real day of a leap year.
				((x.from ?? x.to) === undefined || dayMs(`2000-${x.from}`) + dayMs(`2000-${x.to}`) >= 0) &&
				(x.summer ?? true) === true,
		) &&
		// Ids unique across the event's windows and every rule's: a booking stores only the id.
		list(
			allWindows({ requests: r as unknown as RequestsDoc }).map((w) => w.id),
			88,
			isStr,
		) &&
		int(notice, 0, 365) &&
		dated(r.days, ahead, 365, closed);
	return ok
		? {
				windows: r.windows as RequestWindow[],
				days: r.days as string[],
				aheadDays: ahead as number,
				noticeDays: notice as number,
				closedDates: closed as string[],
				...(rules[0] && { rules }),
			}
		: null;
}

type HasRequests = Pick<EventConfigDoc, "requests"> | null | undefined;
/** Every window of the event's requests and its rules (T176). */
const allWindows = (c: HasRequests) => [c?.requests, ...(c?.requests?.rules ?? [])].flatMap((x) => x?.windows ?? []);
/** The event's window `id`, whichever rule has it (T176): emails, the Bookings page. */
export const windowOf = (c: HasRequests, id?: string) => allWindows(c).find((w) => w.id === id);

/**
 * The windows a request may ask for on local date `YYYY-MM-DD` (T176): the first matching rule's, else the
 * event's (none without requests). `summer`: the zone's offset that day is above its least of the year.
 */
export function windowsOn(c: Pick<EventConfigDoc, "requests" | "info">, date: string): RequestWindow[] {
	const q = c.requests;
	const zone = validZone(c.info?.timezone) ?? "UTC";
	const t = dayMs(date);
	const md = date.slice(5);
	const off = (ms: number) => utcOffsetMinutes(ms, zone);
	const y = +date.slice(0, 4);
	const rule =
		t >= 0 &&
		q?.rules?.find(
			({ days, from = "01-01", to = "12-31", summer }) =>
				(!days || days.includes(weekday(t))) &&
				(from <= to ? from <= md && md <= to : from <= md || md <= to) &&
				(!summer || off(t + DAY / 2) > Math.min(off(Date.UTC(y, 0)), off(Date.UTC(y, 6)))),
		);
	return (rule || q)?.windows ?? [];
}

/**
 * The instant a request's window starts (T174a), or NaN when the event does not take that window on that
 * date at `now`: a listed weekday `noticeDays` to `aheadDays` after today in the event's zone, not closed,
 * the window offered that day (T176) and not started yet.
 */
export function requestStart(
	c: Pick<EventConfigDoc, "requests" | "info">,
	r: NonNullable<BookingDoc["request"]>,
	now: number,
): number {
	const q = c.requests;
	const w = windowsOn(c, r.date).find((x) => x.id === r.window);
	const zone = validZone(c.info?.timezone) ?? "UTC";
	const t = dayMs(r.date);
	const p = utcToZoned(now, zone);
	const ahead = (t - Date.UTC(p.year, p.month - 1, p.day)) / DAY;
	const at = w ? wallMs(r.date, w.start, zone) : Number.NaN;
	const open = q && ahead >= q.noticeDays && ahead <= q.aheadDays && q.days.includes(weekday(t));
	return open && !q.closedDates.includes(r.date) && at > now ? at : Number.NaN;
}

/** Whether the event's occurrences belong to a schedule (it has one, or slots one made). */
export const scheduleOwned = (c: EventConfigDoc | null | undefined): boolean =>
	!!c && (!!c.schedule || keysOf(c.catalog?.occurrences ?? {}).some((k) => k.startsWith("s-")));

export interface SlotPlan {
	/** Wanted slots missing from the catalog, earliest first, at most SLOT_BATCH. */
	add: Array<{ id: string; t: number }>;
	/** Future catalog slots the schedule no longer gives, not yet `kept` (kept if booked, else unlisted). */
	stale: string[];
	/** Slots unlisted a grace period ago: deleted unless a booking landed meanwhile. */
	drop: string[];
	/** Catalog slots that started over a week ago. */
	prune: string[];
	/** The unlisted batch is due (cleared by this run). */
	ready: boolean;
}

/** What the event's schedule still needs, from its config alone; null when nothing. */
export function planSlots(eventId: string, c: EventConfigDoc, now: number): SlotPlan | null {
	const s = c.schedule;
	if (!s) return null;
	const zone = c.info?.timezone ?? "UTC";
	let starts: number[];
	try {
		starts = slotStarts(s, zone, now);
	} catch {
		// This runtime lacks the zone or currency: fall back to a plain format.
		starts = slotStarts(s, "UTC", now);
	}
	const have = c.catalog?.occurrences ?? {};
	const wanted = new Set(starts.map((t) => slotId(eventId, t)));
	const ours = keysOf(have).filter((k) => k.startsWith(`s-${eventId}-`));
	const at = (k: string) => msOf(have[k]?.startsAt);
	const pending = c.unlisted;
	const ready = !!pending && now - pending.at >= GRACE;
	const plan: SlotPlan = {
		add: starts
			.map((t) => ({ id: slotId(eventId, t), t }))
			.filter((x) => !have[x.id])
			.slice(0, SLOT_BATCH),
		stale: pending ? [] : ours.filter((k) => !wanted.has(k) && at(k) >= now && !c.kept?.includes(k)),
		drop: ready ? pending.ids.filter((k) => !wanted.has(k) && !have[k]) : [],
		prune: ours.filter((k) => at(k) < now - PRUNE),
		ready,
	};
	return plan.add.length + plan.stale.length + plan.prune.length || ready ? plan : null;
}
