import {
	actions,
	type Block,
	button,
	column,
	type FormField,
	form,
	numberInput,
	pad2,
	select,
	table,
	textInput,
	toggle,
	utcToZoned,
	validZone,
} from "@semics-tech/shared";

import { entryOf } from "../cron/schedule";
import { LIVE_BOOKING_STATUSES } from "../domain/inventory";
import { allOf, CAPACITY_BELOW_RESERVED, CLOSED, ERROR, isInt, keysOf, maxOf, OPEN } from "../domain/names";
import { dayBounds, parseSchedule } from "../domain/schedule";
import { msOf } from "../domain/time";
import type { BookingDoc, EventConfigDoc, OccurrenceDoc } from "../storage/schema";
import { SAVED, saveRefused } from "./messages";
import { countColumns, held, initial, panelView, say, str } from "./ui";

/**
 * The editor panel's Schedule section and day view (EV-FR-17, T129). The section edits
 * `config.schedule` with the rest of the panel form; the day view lists one local day's slots and
 * closes, reopens or re-sizes them (an override on the slot that the cron keeps), without touching the
 * schedule. Closing a slot with seats held or sold is refused with its bookings listed.
 *
 * Day view: config read + `getMany` of the day's slots (2 calls). Saving: those 2, one guarded
 * `updateIf` per changed slot (at most `MAX_DAY_CHANGES`; more are left for the next save), then the
 * catalog (bumping `slotsRev`, so a racing cron write is redone): <= 8. A refusal reads the event's
 * live bookings instead (3).
 */
type Obj = Record<string, unknown>;
interface DayDeps {
	storage: {
		event_configs: {
			get(id: string): Promise<unknown>;
			updateIf(id: string, a: object): Promise<{ applied: boolean }>;
		};
		occurrences: {
			getMany(ids: string[]): Promise<Map<string, unknown>>;
			updateIf(id: string, a: object): Promise<{ applied: boolean; data?: unknown }>;
		};
		bookings: { query(o: object): Promise<{ items: Array<{ data: unknown }> }> };
	};
}

const MAX_DAY_CHANGES = 5;
const split = (v: unknown) =>
	str(v, 4000)
		.split(/[\s,]+/)
		.filter(Boolean);
const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));
const pad = pad2;

/** The event's zone, from the copy of its entry's info; UTC when it has none. */
export const zoneOf = (config?: EventConfigDoc | null): string => validZone(config?.info?.timezone) ?? "UTC";

/** `2026-12-01 19:30` in the zone. */
export function localText(iso: string, zone: string): string {
	const p = utcToZoned(msOf(iso), zone);
	return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** A list as the panel's comma-separated starting value. */
const list = (v?: string[]) => initial(v?.join(", ") ?? "");
/** Weekdays typed in a panel field, upper-cased. */
const days = (v: unknown) => split(v).map((d) => d.toUpperCase());

export function scheduleFields(s: EventConfigDoc["schedule"]): FormField[] {
	return [
		textInput("sc_days", "Schedule: days (MO to SU)", list(s?.days)),
		textInput("sc_times", "Schedule: start times (09:00, 10:30)", list(s?.times)),
		numberInput("sc_length", "Schedule: minutes per slot", { initialValue: s?.durationMinutes ?? 60, min: 1 }),
		numberInput("sc_places", "Schedule: places per slot", { ...(s ? { initialValue: s.capacity } : {}), min: 1 }),
		numberInput("sc_ahead", "Schedule: days bookable ahead", { initialValue: s?.bookAheadDays ?? 56, min: 1 }),
		textInput("sc_closed", "Schedule: closed dates (YYYY-MM-DD)", list(s?.closedDates)),
	];
}

/** The schedule a panel save asks for (null: none), from the form values and the stored one. */
export function scheduleInput(values: Obj, stored: EventConfigDoc["schedule"], capacity: number): unknown {
	if (values.sc_days === undefined && values.sc_times === undefined) return stored ?? null;
	const weekdays = days(values.sc_days);
	const times = split(values.sc_times);
	if (weekdays.length + times.length === 0) return null;
	const s = {
		days: weekdays,
		times,
		durationMinutes: num(values.sc_length) ?? stored?.durationMinutes,
		capacity: num(values.sc_places) ?? stored?.capacity ?? capacity,
		bookAheadDays: num(values.sc_ahead) ?? 56,
		closedDates: split(values.sc_closed),
	};
	return parseSchedule(s) ?? s;
}

/** The panel's "Booking requests" fields (T174a): windows as `Label HH:MM-HH:MM` lines. */
export function requestFields(r: EventConfigDoc["requests"]): FormField[] {
	return [
		textInput("rq_windows", "Booking requests: windows (AM 10:00-12:00, a line each)", {
			initialValue: r?.windows.map((w) => `${w.label} ${w.start}-${w.end}`).join("\n"),
			multiline: true,
		}),
		textInput("rq_days", "Requests: days (MO,TU,…)", list(r?.days)),
		numberInput("rq_ahead", "Requests: days ahead", { initialValue: r?.aheadDays ?? 90, min: 1 }),
		numberInput("rq_notice", "Requests: days' notice", { initialValue: r?.noticeDays ?? 0, min: 0 }),
		textInput("rq_closed", "Requests: closed dates", list(r?.closedDates)),
	];
}

/** The requests a panel save asks for (null: none); a line that does not parse is refused by the validator. */
export function requestsInput(values: Obj, stored: EventConfigDoc["requests"]): unknown {
	if (values.rq_windows === undefined && values.rq_days === undefined) return stored ?? null;
	const windows = str(values.rq_windows, 4000)
		.split(/\s*\n\s*/)
		.filter(Boolean)
		.map((l) => {
			const [, label = l, start, end] = /(.+?) +(\d\d:\d\d) *- *(\d\d:\d\d)$/.exec(l) ?? [];
			return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label, start, end };
		});
	const weekdays = days(values.rq_days);
	// In the stored shape's key order, so an unchanged form compares equal; `config/save` validates it.
	return windows.length + weekdays.length
		? {
				windows,
				days: weekdays,
				aheadDays: num(values.rq_ahead) ?? 90,
				noticeDays: num(values.rq_notice) ?? 0,
				closedDates: split(values.rq_closed),
			}
		: null;
}

const dayField = (day: string) => textInput("day", "Day (YYYY-MM-DD)", initial(day));

export const dayPicker = (day = ""): Block =>
	form({ fields: [dayField(day)], submit: { label: "Show day", actionId: "panel.day" }, blockId: "day" });

/** `panel.day` (show) and `panel.day.save` (apply the form's changes). */
export async function dayPanel(deps: DayDeps, eventId: string, values: Obj, save: boolean) {
	const { storage } = deps;
	const config = (await storage.event_configs.get(eventId)) as EventConfigDoc | null;
	const day = str(values.day, 10);
	const zone = config ? zoneOf(config) : "UTC";
	const bounds = dayBounds(day, zone);
	const back = actions([button("panel.back", "Back to the event", { style: "secondary" })]);
	let extra: Block[] = [];
	if (!config || !bounds) {
		return panelView([...say(ERROR, "Enter a day such as 2026-12-01"), dayPicker(day), back]);
	}
	const slots = { ...config.catalog?.occurrences };
	const at = (id: string) => msOf(slots[id]?.startsAt);
	const ids = keysOf(slots)
		.filter((id) => at(id) >= bounds[0] && at(id) < bounds[1])
		.sort((a, b) => at(a) - at(b));
	const docs = (ids.length > 0 ? await storage.occurrences.getMany(ids) : new Map()) as Map<string, OccurrenceDoc>;
	const time = (d: OccurrenceDoc) => localText(d.startsAt, zone).slice(11);
	if (save) {
		const all = values.day_all;
		const changes = ids.flatMap((id) => {
			const d = docs.get(id);
			if (!d) return [];
			const open = values[`sl_open:${id}`];
			let status = typeof open === "boolean" && open !== (d.status === OPEN) ? (open ? OPEN : CLOSED) : d.status;
			if (all === OPEN || (all === CLOSED && d.status === OPEN)) status = all;
			const places = num(values[`sl_places:${id}`]) ?? d.capacity;
			return status === d.status && places === d.capacity ? [] : [{ id, d, status, places }];
		});
		const closing = changes.filter((c) => c.status !== OPEN && c.d.status === OPEN && c.d.reserved + c.d.sold > 0);
		const bad = changes.find((c) => !isInt(c.places) || c.places < maxOf(c.d.reserved, 1));
		if (closing.length > 0) {
			const refused = new Set(closing.map((c) => c.id));
			const { items } = await storage.bookings.query({
				where: { eventId, status: { in: [...LIVE_BOOKING_STATUSES] } },
				limit: 100,
			});
			const refs = items
				.map((i) => i.data as BookingDoc)
				.filter((b) => refused.has(b.occurrenceId ?? ""))
				.map((b) => `${b.ref} (${b.buyer?.name}, ${b.status})`);
			extra = say(
				ERROR,
				"Not saved: booked slots cannot be closed",
				`${closing.map((c) => time(c.d)).join(", ")}: ${refs.join("; ") || "seats held or sold"}.`,
			);
		} else if (bad) {
			extra = saveRefused([{ path: "", code: bad.places >= 1 ? CAPACITY_BELOW_RESERVED : "INVALID_CAPACITY" }]);
		} else if (changes.length > 0) {
			const now = changes.slice(0, MAX_DAY_CHANGES);
			const done = await allOf(
				now.map((c) =>
					storage.occurrences.updateIf(c.id, {
						where: c.status === OPEN ? { reserved: { lte: c.places } } : { reserved: 0, sold: 0 },
						set: { status: c.status, capacity: c.places },
					}),
				),
			);
			let missed = 0;
			now.forEach((c, i) => {
				const data = done[i]?.data as OccurrenceDoc | undefined;
				if (!data) {
					missed++;
					return;
				}
				docs.set(c.id, data);
				slots[c.id] = entryOf(data);
			});
			await storage.event_configs.updateIf(eventId, {
				where: {},
				set: { catalog: { ticketTypes: config.catalog?.ticketTypes ?? {}, occurrences: slots } },
				delta: { slotsRev: { inc: 1 } },
			});
			const left = changes.length - now.length;
			extra = missed
				? saveRefused([{ path: "", code: "UNKNOWN_ID" }])
				: SAVED(left > 0 ? `${left} more change(s) not saved yet: save again.` : "The slots were updated.");
		}
	}
	const rows = ids.flatMap((id) => {
		const d = docs.get(id);
		return d ? [{ id, d }] : [];
	});
	const fields: FormField[] = [
		dayField(day),
		select(
			"day_all",
			"Whole day",
			[
				{ label: "As set below", value: "" },
				{ label: "Close every slot", value: CLOSED },
				{ label: "Reopen every slot", value: OPEN },
			],
			{ initialValue: "" },
		),
		...rows.flatMap(({ id, d }) => [
			toggle(`sl_open:${id}`, `${time(d)} open`, initial(d.status === OPEN)),
			numberInput(`sl_places:${id}`, `${time(d)} places`, { initialValue: d.capacity, min: 1 }),
		]),
	];
	return panelView([
		...extra,
		table({
			columns: [
				column("time", `${day} (${zone})`),
				column("status", "Status", "badge"),
				...countColumns("places", "Places"),
			],
			rows: rows.map(({ d }) => ({ time: time(d), status: d.status, sold: d.sold, held: held(d), places: d.capacity })),
			pageActionId: "panel.day.page",
			emptyText: "No slots on this day.",
		}),
		form({ fields, submit: { label: "Save day", actionId: "panel.day.save" }, blockId: "day" }),
		back,
	]);
}
