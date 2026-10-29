import {
	actions,
	type Block,
	button,
	column,
	type FormField,
	form,
	header,
	isValidTimeZone,
	notices,
	numberInput,
	select,
	table,
	textInput,
	toggle,
	utcToZoned,
} from "@semics-tech/shared";

import { LIVE_BOOKING_STATUSES } from "../domain/inventory";
import { dayBounds, parseSchedule } from "../domain/schedule";
import { entryOf } from "../cron/schedule";
import type { BookingDoc, EventConfigDoc, OccurrenceDoc } from "../storage/schema";
import { SAVED, saveRefused } from "./messages";
import { held, respond, str } from "./ui";

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
		event_configs: { get(id: string): Promise<unknown>; updateIf(id: string, a: object): Promise<{ applied: boolean }> };
		occurrences: {
			getMany(ids: string[]): Promise<Map<string, unknown>>;
			updateIf(id: string, a: object): Promise<{ applied: boolean; data?: unknown }>;
		};
		bookings?: { query(o: object): Promise<{ items: Array<{ data: unknown }> }> };
	};
}

const MAX_DAY_CHANGES = 5;
const split = (v: unknown) => str(v, 4000).split(/[\s,]+/).filter(Boolean);
const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));

/** The event's zone, from the copy of its entry's info; UTC when it has none. */
export const zoneOf = (config: EventConfigDoc): string => {
	const zone = config.info?.timezone;
	return zone && isValidTimeZone(zone) ? zone : "UTC";
};

const hhmm = (iso: string, zone: string) => {
	const p = utcToZoned(Date.parse(iso), zone);
	return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

export function scheduleFields(s: EventConfigDoc["schedule"]): FormField[] {
	return [
		textInput("sc_days", "Schedule: days", { initialValue: s?.days.join(", ") ?? "", placeholder: "MO, WE, SA" }),
		textInput("sc_times", "Schedule: start times", { initialValue: s?.times.join(", ") ?? "", placeholder: "09:00, 10:30" }),
		numberInput("sc_length", "Schedule: minutes per slot", { initialValue: s?.durationMinutes ?? 60, min: 1 }),
		numberInput("sc_places", "Schedule: places per slot", { ...(s ? { initialValue: s.capacity } : {}), min: 1 }),
		numberInput("sc_ahead", "Schedule: days bookable ahead", { initialValue: s?.bookAheadDays ?? 56, min: 1 }),
		textInput("sc_closed", "Schedule: closed dates", { initialValue: s?.closedDates.join(", ") ?? "" }),
	];
}

/** The schedule a panel save asks for (null: none), from the form values and the stored one. */
export function scheduleInput(values: Obj, stored: EventConfigDoc["schedule"], capacity: number): unknown {
	if (values.sc_days === undefined && values.sc_times === undefined) return stored ?? null;
	const days = split(values.sc_days).map((d) => d.toUpperCase());
	const times = split(values.sc_times);
	if (days.length + times.length === 0) return null;
	const s = {
		days,
		times,
		durationMinutes: num(values.sc_length) ?? stored?.durationMinutes,
		capacity: num(values.sc_places) ?? stored?.capacity ?? capacity,
		bookAheadDays: num(values.sc_ahead) ?? 56,
		closedDates: split(values.sc_closed),
	};
	return parseSchedule(s) ?? s;
}

export const dayPicker = (day = ""): Block =>
	form({
		fields: [textInput("day", "Day (YYYY-MM-DD)", { initialValue: day })],
		submit: { label: "Show day", actionId: "panel.day" },
		blockId: "day",
	});

/** `panel.day` (show) and `panel.day.save` (apply the form's changes). */
export async function dayPanel(deps: DayDeps, eventId: string, values: Obj, save: boolean) {
	const { storage } = deps;
	const config = (await storage.event_configs.get(eventId)) as EventConfigDoc | null;
	const day = str(values.day, 10);
	const zone = config ? zoneOf(config) : "UTC";
	const bounds = dayBounds(day, zone);
	const top = [header("Tickets & booking")];
	const back = actions([button("panel.back", "Back to the event", { style: "secondary" })]);
	if (!config || !bounds) {
		return respond([...top, ...notices([{ severity: "error", title: "Enter a day such as 2026-12-01" }]), dayPicker(day), back]);
	}
	const slots = { ...config.catalog?.occurrences };
	const at = (id: string) => Date.parse(slots[id]?.startsAt ?? "");
	const ids = Object.keys(slots)
		.filter((id) => at(id) >= bounds[0] && at(id) < bounds[1])
		.sort((a, b) => at(a) - at(b));
	const docs = (ids.length > 0 ? await storage.occurrences.getMany(ids) : new Map()) as Map<string, OccurrenceDoc>;
	let extra: Block[] = [];
	if (save) {
		const all = values.day_all;
		const changes = ids.flatMap((id) => {
			const d = docs.get(id);
			if (!d) return [];
			const open = values[`sl_open:${id}`];
			let status = typeof open === "boolean" && open !== (d.status === "open") ? (open ? "open" : "closed") : d.status;
			if (all === "open" || (all === "closed" && d.status === "open")) status = all;
			const places = num(values[`sl_places:${id}`]) ?? d.capacity;
			return status === d.status && places === d.capacity ? [] : [{ id, d, status, places }];
		});
		const closing = changes.filter((c) => c.status !== "open" && c.d.status === "open" && c.d.reserved + c.d.sold > 0);
		const issue =
			changes.find((c) => !Number.isSafeInteger(c.places) || c.places < 1)?.id ?? "";
		const below = changes.find((c) => c.places < c.d.reserved);
		if (closing.length > 0) {
			const refused = new Set(closing.map((c) => c.id));
			const { items } = (await storage.bookings?.query({
				where: { eventId, status: { in: [...LIVE_BOOKING_STATUSES] } },
				limit: 100,
			})) ?? { items: [] };
			const refs = items
				.map((i) => i.data as BookingDoc)
				.filter((b) => refused.has(b.occurrenceId ?? ""))
				.map((b) => `${b.ref} (${b.buyer?.name ?? ""}, ${b.status})`);
			extra = notices([
				{
					severity: "error",
					title: "Not saved: booked slots cannot be closed",
					message: `${closing.map((c) => hhmm(c.d.startsAt, zone)).join(", ")} ${refs.length > 0 ? `has bookings: ${refs.join("; ")}` : "has seats held or sold"}.`,
				},
			]);
		} else if (issue || below) {
			extra = saveRefused([{ path: "", code: issue ? "INVALID_CAPACITY" : "CAPACITY_BELOW_RESERVED" }]);
		} else if (changes.length > 0) {
			const now = changes.slice(0, MAX_DAY_CHANGES);
			const done = await Promise.all(
				now.map((c) =>
					storage.occurrences.updateIf(c.id, {
						where: c.status === "open" ? { reserved: { lte: c.places } } : { reserved: 0, sold: 0 },
						set: { status: c.status, capacity: c.places },
					}),
				),
			);
			now.forEach((c, i) => {
				const data = done[i]?.applied ? (done[i]?.data as OccurrenceDoc | undefined) : undefined;
				if (!data) return;
				docs.set(c.id, data);
				slots[c.id] = entryOf(data);
			});
			await storage.event_configs.updateIf(eventId, {
				where: {},
				set: { catalog: { ticketTypes: config.catalog?.ticketTypes ?? {}, occurrences: slots } },
				delta: { slotsRev: { inc: 1 } },
			});
			const missed = done.filter((d) => !d.applied).length;
			const left = changes.length - now.length;
			extra = missed
				? saveRefused([{ path: "", code: "UNKNOWN_ID" }])
				: SAVED(left > 0 ? `${left} more change(s) not saved yet: save again.` : "The slots were updated.");
		}
	}
	const rows = ids.flatMap((id) => {
		const d = docs.get(id);
		return d ? [{ id, d, time: hhmm(d.startsAt, zone) }] : [];
	});
	const fields: FormField[] = [
		textInput("day", "Day (YYYY-MM-DD)", { initialValue: day }),
		select(
			"day_all",
			"Whole day",
			[
				{ label: "As set below", value: "" },
				{ label: "Close every slot", value: "closed" },
				{ label: "Reopen every slot", value: "open" },
			],
			{ initialValue: "" },
		),
		...rows.flatMap(({ id, d, time }) => [
			toggle(`sl_open:${id}`, `${time} open`, { initialValue: d.status === "open" }),
			numberInput(`sl_places:${id}`, `${time} places`, { initialValue: d.capacity, min: 1 }),
		]),
	];
	return respond([
		...top,
		...extra,
		table({
			columns: [
				column("time", `${day} (${zone})`),
				column("status", "Status", "badge"),
				column("sold", "Sold", "number"),
				column("held", "Held", "number"),
				column("places", "Places", "number"),
			],
			rows: rows.map(({ d, time }) => ({ time, status: d.status, sold: d.sold, held: held(d), places: d.capacity })),
			pageActionId: "panel.day.page",
			emptyText: "No slots on this day.",
		}),
		form({ fields, submit: { label: "Save day", actionId: "panel.day.save" }, blockId: "day" }),
		back,
	]);
}
