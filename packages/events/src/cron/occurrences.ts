/**
 * Recurring events (EV-FR-17, T084): the recurring `occurrences` task materialises each event's
 * series (`config.recurrence`, the shared RRULE subset) into the `occurrences` collection over a
 * rolling window: the next `OCCURRENCES_WINDOW` dates within `HORIZON` from now, never more per run
 * and never past `MAX_OCCURRENCES` per event. The series starts at the entry's start (`info`) in its
 * zone; each date takes the entry's length and the event capacity.
 *
 * A tick (R22, at most 8 calls): the paging cursor from KV (1), one page of configs (1); the plan is
 * worked out from each config's catalog alone, so events with nothing to do cost nothing. One event
 * with work is then loaded (3) and saved through `saveConfig` (at most 3 writes, the guards of
 * T042/T044 included): either one stale series date without bookings is removed, or the missing
 * dates are created with ids `r-<eventId>-<start in base 36>`. Stored dates are passed back
 * unchanged, so a date with bookings is never moved or deleted (a removal that loses the race to a
 * booking is refused with `ITEM_IN_USE`). Stale = a future series date the rule no longer gives
 * (the rule or the start changed), or, when the event is out of room, a past one. Events with work
 * take turns (by the ten-minute slot), so one that cannot progress never starves the rest; a page
 * without work moves the cursor on (KV write, no load), wrapping after the last page.
 *
 * Slot schedules (T129) share the task: a config with `schedule` is planned by `planSlots` and run by
 * `scheduleStep` (`src/cron/schedule.ts`) instead.
 */
import { occurrencesBetween, parseRrule, validZone } from "@semics-tech/shared";

import { MAX_OCCURRENCES } from "../domain/config";
import { planSlots } from "../domain/schedule";
import { iso, msOf } from "../domain/time";
import { type ConfigStorage, loadEventState, saveConfig } from "../routes/config";
import type { EventConfigDoc, OccurrenceDoc } from "../storage/schema";
import { scheduleStep } from "./schedule";

export const OCCURRENCES_TASK = "occurrences";
export const OCCURRENCES_SCHEDULE = "*/10 * * * *";
/** Dates ahead of now a series keeps: the window size, and the most one run creates. */
export const OCCURRENCES_WINDOW = 20;
const HORIZON = 60 * 864e5;
const SLOT = 600_000;
const STATE_KEY = "cron:occurrences";
const PAGE = 100;

export interface OccurrencesDeps {
	storage: ConfigStorage;
	kv: { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<void> };
}

/** What a config's series still needs: dates to create (UTC ms) and stale series dates (ids). */
function plan(eventId: string, c: EventConfigDoc, now: number) {
	const rule = c.recurrence ? parseRrule(c.recurrence) : null;
	const info = c.info;
	if (!rule || !info) return null;
	const zone = validZone(info.timezone) ?? "UTC";
	const starts = occurrencesBetween(rule, Date.parse(info.startsAt), zone, now, now + HORIZON, OCCURRENCES_WINDOW);
	const have = c.catalog?.occurrences ?? {};
	const prefix = `r-${eventId}-`;
	const id = (t: number) => prefix + t.toString(36);
	const wanted = new Set(starts.map(id));
	const missing = starts.filter((t) => !have[id(t)]);
	const room = MAX_OCCURRENCES - Object.keys(have).length;
	const series = Object.keys(have)
		.filter((k) => k.startsWith(prefix) && !wanted.has(k))
		.sort((a, b) => msOf(have[a]?.startsAt) - msOf(have[b]?.startsAt));
	const stale = series.filter((k) => msOf(have[k]?.startsAt) >= now || missing.length > room);
	const add = missing.slice(0, Math.max(room, 0));
	return add.length > 0 || stale.length > 0 ? { add, stale, id, info } : null;
}

export async function occurrencesTick({ storage, kv }: OccurrencesDeps, now: number): Promise<void> {
	const state = (await kv.get<{ cursor?: string }>(STATE_KEY)) ?? {};
	const page = (await storage.event_configs.query({
		limit: PAGE,
		...(state.cursor ? { cursor: state.cursor } : {}),
	})) as { items: Array<{ id: string; data: unknown }>; hasMore?: boolean; cursor?: string };
	// Slot schedules (T129) plan and run in `src/cron/schedule.ts`, taking turns with series.
	const work = page.items.flatMap(({ id, data }) => {
		const c = data as EventConfigDoc;
		const p = c.schedule ? planSlots(id, c, now) : plan(id, c, now);
		return p ? [{ eventId: id, c, p }] : [];
	});
	const pick = work[Math.floor(now / SLOT) % work.length];
	if (!pick) {
		const cursor = page.hasMore ? page.cursor : undefined;
		if (cursor !== state.cursor) await kv.set(STATE_KEY, cursor ? { cursor } : {});
		return;
	}
	const { eventId, c, p } = pick;
	if ("drop" in p) return scheduleStep(storage, eventId, c, p, now);
	const { add, stale, id, info } = p;
	const loaded = await loadEventState(eventId, storage);
	if (!loaded.config) return;
	const { catalog: _catalog, info: _info, ...config } = loaded.config;
	// One stale date without bookings goes per run; dates are added only once none is left.
	const drop = loaded.occurrences.find((o) => {
		const d = o.data as OccurrenceDoc;
		return stale.includes(o.id) && !d.reserved && !d.sold;
	})?.id;
	const length = info.endsAt ? Date.parse(info.endsAt) - Date.parse(info.startsAt) : 0;
	const created = drop ? [] : add;
	const ids = created.map(id);
	await saveConfig(
		storage,
		{
			eventId,
			config,
			ticketTypes: loaded.ticketTypes.map((t) => ({ ...(t.data as object), id: t.id })),
			occurrences: [
				...loaded.occurrences.filter((o) => o.id !== drop).map((o) => ({ ...(o.data as object), id: o.id })),
				...created.map((t) => ({
					startsAt: iso(t),
					...(length > 0 ? { endsAt: iso(t + length) } : {}),
					capacity: config.capacity,
				})),
			],
		},
		() => ids.shift() ?? crypto.randomUUID(),
		loaded,
		undefined,
		undefined,
		2,
	);
}

/** The `cron` hook's share for the task; true when `event` was ours. */
export async function runOccurrencesJob(
	event: { name: string },
	ctx: { storage: unknown; kv: unknown },
	now = Date.now(),
): Promise<boolean> {
	if (event.name !== OCCURRENCES_TASK) return false;
	await occurrencesTick(ctx as OccurrencesDeps, now);
	return true;
}
