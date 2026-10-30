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
import { utcOffsetMinutes, utcParts, utcToZoned, WEEKDAYS, zonedToUtc } from "@semics-tech/shared";

import type { EventConfigDoc, ScheduleDoc } from "../storage/schema";
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
const int = (v: unknown, min: number, max: number) =>
	Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const list = (v: unknown, max: number, ok: (s: string) => boolean) =>
	Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every((s) => typeof s === "string" && ok(s));

/** Naive (local-as-UTC) ms of a real `YYYY-MM-DD`, else NaN. */
const dayMs = (d: string) => {
	const t = DATE.test(d) ? Date.parse(d) : Number.NaN;
	return t >= 0 && new Date(t).toISOString().startsWith(d) ? t : Number.NaN;
};

/** A valid schedule (times sorted, defaults filled), or null. */
export function parseSchedule(raw: unknown): ScheduleDoc | null {
	const s = (raw ?? 0) as Record<string, unknown>;
	const ahead = s.bookAheadDays ?? 56;
	const closed = s.closedDates ?? [];
	const ok =
		typeof raw === "object" &&
		list(s.days, 7, (d) => DAYS.includes(d)) &&
		list(s.times, 24, (t) => TIME.test(t)) &&
		(s.days as string[]).length > 0 &&
		(s.times as string[]).length > 0 &&
		int(s.durationMinutes, 1, 1440) &&
		int(s.capacity, 1, 1e6) &&
		int(ahead, 1, 90) &&
		Array.isArray(closed) &&
		closed.length <= 366 &&
		closed.every((d) => typeof d === "string" && dayMs(d) >= 0);
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
		if (!s.days.includes(DAYS[(new Date(day).getUTCDay() + 6) % 7] as string) || s.closedDates.includes(stamp))
			continue;
		const [a, b] = [offs[i] as number, offs[i + 2] as number];
		for (const time of s.times) {
			const w = day + (+time.slice(0, 2) * 60 + +time.slice(3)) * 60_000;
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
	const at = (ms: number) => zonedToUtc({ ...utcParts(ms), hour: 0, minute: 0, second: 0 }, zone);
	return [at(t), at(t + DAY)];
}

/** Whether the event's occurrences belong to a schedule (it has one, or slots one made). */
export const scheduleOwned = (c: EventConfigDoc | null | undefined): boolean =>
	!!c && (!!c.schedule || Object.keys(c.catalog?.occurrences ?? {}).some((k) => k.startsWith("s-")));

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
		starts = slotStarts(s, "UTC", now);
	}
	const have = c.catalog?.occurrences ?? {};
	const wanted = new Set(starts.map((t) => slotId(eventId, t)));
	const ours = Object.keys(have).filter((k) => k.startsWith(`s-${eventId}-`));
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
	return plan.add.length + plan.stale.length + plan.prune.length > 0 || ready ? plan : null;
}
