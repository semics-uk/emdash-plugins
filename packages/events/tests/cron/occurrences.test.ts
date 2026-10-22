import { utcToZoned } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import {
	OCCURRENCES_SCHEDULE,
	OCCURRENCES_TASK,
	OCCURRENCES_WINDOW,
	type OccurrencesDeps,
	occurrencesTick,
} from "../../src/cron/occurrences";
import { MAX_OCCURRENCES } from "../../src/domain/config";
import { FakeKv, makeStore, meter } from "../domain/fake-storage";

// Recurring events (EV-FR-17, R22): the `occurrences` job materialises a series into the
// `occurrences` collection over a rolling window, a bounded number per run, through `saveConfig`
// (so the ITEM_IN_USE and capacity guards of T042/T044 apply), and never moves or deletes a date
// that holds bookings. Every tick is at most 8 bridge calls.

const DAY = 864e5;
const T0 = Date.parse("2026-10-18T12:00:00.000Z");
const TARGET = 8;

// biome-ignore lint/suspicious/noExplicitAny: test reads loose documents
type Doc = Record<string, any>;

class Kv extends FakeKv {
	async set(key: string, value: unknown) {
		meter.calls++;
		this.values.set(key, { value: structuredClone(value), revision: "1" });
	}
}

function world() {
	const store = makeStore();
	const kv = new Kv();
	const deps = { storage: store, kv } as unknown as OccurrencesDeps;
	return { store, kv, deps };
}

type Store = ReturnType<typeof makeStore>;

function series(
	s: Store,
	recurrence: string | null,
	{ id = "ev1", startsAt = "2026-10-19T18:30:00.000Z", timezone = "Europe/London" } = {},
) {
	s.event_configs.set(id, {
		status: "on_sale",
		capacity: 40,
		reserved: 0,
		sold: 0,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: false,
		recurrence,
		catalog: {
			ticketTypes: {
				[`${id}_tt`]: {
					capacity: 40,
					priceMinor: 0,
					hidden: false,
					minPerOrder: null,
					maxPerOrder: null,
					salesStart: null,
					salesEnd: null,
				},
			},
			occurrences: {},
		},
		info: { title: "Quiz night", startsAt, endsAt: "2026-10-19T20:30:00.000Z", timezone, venue: null },
	});
	s.ticket_types.set(`${id}_tt`, {
		eventId: id,
		name: "Entry",
		priceMinor: 0,
		capacity: 40,
		reserved: 0,
		sold: 0,
		hidden: false,
		sort: 0,
	});
}

const dates = (s: Store, id = "ev1") =>
	[...s.occurrences.docs.entries()]
		.filter(([, d]) => d.eventId === id)
		.map(([oid, d]): Doc => ({ id: oid, ...d }))
		.sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));

const catalogIds = (s: Store, id = "ev1") =>
	Object.keys((s.event_configs.docs.get(id) as Doc).catalog.occurrences).sort();

async function tick(deps: OccurrencesDeps, now: number) {
	meter.calls = 0;
	await occurrencesTick(deps, now);
	expect(meter.calls).toBeLessThanOrEqual(TARGET);
	return meter.calls;
}

beforeEach(() => {
	meter.calls = 0;
});

describe("occurrence materialiser (EV-FR-17, R22)", () => {
	it("EV-FR-17 is the recurring occurrences task, every 10 minutes", () => {
		expect([OCCURRENCES_TASK, OCCURRENCES_SCHEDULE]).toEqual(["occurrences", "*/10 * * * *"]);
	});

	it("EV-FR-17 expansion never exceeds the window size per run", async () => {
		const { store, deps } = world();
		series(store, "FREQ=DAILY");
		await tick(deps, T0);
		expect(dates(store)).toHaveLength(OCCURRENCES_WINDOW);
		// The catalog mirrors the documents, so checkout can sell every date at once.
		expect(catalogIds(store)).toEqual(
			dates(store)
				.map((d) => d.id)
				.sort(),
		);

		// Nothing new is due: the tick only reads (KV and the config page).
		expect(await tick(deps, T0)).toBeLessThanOrEqual(2);
		expect(dates(store)).toHaveLength(OCCURRENCES_WINDOW);

		// Five days on (four dates have passed): four more. The window rolls; it never runs ahead.
		await tick(deps, T0 + 5 * DAY);
		expect(dates(store)).toHaveLength(OCCURRENCES_WINDOW + 4);
		expect(dates(store).filter((d) => Date.parse(d.startsAt) >= T0 + 5 * DAY)).toHaveLength(OCCURRENCES_WINDOW);
	});

	it("EV-FR-17 DST transitions keep local times in the stored dates (London, 25 October 2026)", async () => {
		const { store, deps } = world();
		series(store, "FREQ=WEEKLY;COUNT=3");
		await tick(deps, T0);
		const stored = dates(store);
		expect(stored.map((d) => d.startsAt)).toEqual([
			"2026-10-19T18:30:00.000Z",
			"2026-10-26T19:30:00.000Z",
			"2026-11-02T19:30:00.000Z",
		]);
		for (const d of stored) {
			const local = utcToZoned(Date.parse(d.startsAt), "Europe/London");
			expect([local.hour, local.minute]).toEqual([19, 30]);
			// The entry's length (2 hours) and the event capacity carry over.
			expect(Date.parse(d.endsAt) - Date.parse(d.startsAt)).toBe(2 * 3_600_000);
			expect(d).toMatchObject({ capacity: 40, reserved: 0, sold: 0, status: "open" });
		}
	});

	it("EV-FR-17 editing a series keeps booked occurrences", async () => {
		const { store, deps } = world();
		series(store, "FREQ=WEEKLY;BYDAY=MO;COUNT=4");
		await tick(deps, T0);
		const mondays = dates(store);
		expect(mondays).toHaveLength(4);
		// Seats are booked on the second Monday.
		const booked = mondays[1] as Doc;
		store.occurrences.set(booked.id, { ...store.occurrences.docs.get(booked.id), reserved: 2, sold: 2 });

		// The organiser moves the series to Tuesdays (and makes it longer).
		const config = store.event_configs.docs.get("ev1") as Doc;
		store.event_configs.set("ev1", { ...config, recurrence: "FREQ=WEEKLY;BYDAY=TU;COUNT=5" });
		for (let i = 0; i < 12; i++) await tick(deps, T0);

		const after = dates(store);
		const kept = after.find((d) => d.id === booked.id);
		expect(kept).toMatchObject({ startsAt: booked.startsAt, capacity: 40, reserved: 2, sold: 2, status: "open" });
		const others = after.filter((d) => d.id !== booked.id);
		expect(others).toHaveLength(5);
		for (const d of others) expect(new Date(d.startsAt).getUTCDay()).toBe(2);
		expect(catalogIds(store)).toEqual(after.map((d) => d.id).sort());
	});

	it("EV-FR-17 never goes past the per-event date limit", async () => {
		const { store, deps } = world();
		series(store, "FREQ=DAILY");
		const config = store.event_configs.docs.get("ev1") as Doc;
		for (let i = 0; i < MAX_OCCURRENCES - 3; i++) {
			const startsAt = new Date(T0 - (i + 1) * DAY).toISOString();
			store.occurrences.set(`old${i}`, {
				eventId: "ev1",
				startsAt,
				capacity: 40,
				reserved: 1,
				sold: 1,
				status: "open",
			});
			config.catalog.occurrences[`old${i}`] = { capacity: 40, startsAt, status: "open" };
		}
		await tick(deps, T0);
		expect(dates(store)).toHaveLength(MAX_OCCURRENCES);
		await tick(deps, T0 + DAY);
		expect(dates(store)).toHaveLength(MAX_OCCURRENCES);
	});

	it("EV-FR-17 past series dates without bookings make room for new ones", async () => {
		const { store, deps } = world();
		series(store, "FREQ=DAILY");
		const config = store.event_configs.docs.get("ev1") as Doc;
		for (let i = 0; i < MAX_OCCURRENCES - OCCURRENCES_WINDOW; i++) {
			const startsAt = new Date(T0 - (i + 1) * DAY).toISOString();
			store.occurrences.set(`old${i}`, {
				eventId: "ev1",
				startsAt,
				capacity: 40,
				reserved: 1,
				sold: 1,
				status: "open",
			});
			config.catalog.occurrences[`old${i}`] = { capacity: 40, startsAt, status: "open" };
		}
		await tick(deps, T0);
		expect(dates(store)).toHaveLength(MAX_OCCURRENCES);
		// Two days later the first series date has passed: it goes (no bookings) and the next one comes.
		for (let i = 0; i < 3; i++) await tick(deps, T0 + 2 * DAY);
		const now = dates(store);
		expect(now).toHaveLength(MAX_OCCURRENCES);
		expect(now.filter((d) => Date.parse(d.startsAt) >= T0 + 2 * DAY)).toHaveLength(OCCURRENCES_WINDOW);
		expect(now.some((d) => d.startsAt === "2026-10-19T18:30:00.000Z")).toBe(false);
		// The booked manual dates are all still there.
		expect(now.filter((d) => d.id.startsWith("old"))).toHaveLength(MAX_OCCURRENCES - OCCURRENCES_WINDOW);
	});

	it("EV-FR-17 shares the ticks between recurring events and leaves the others alone", async () => {
		const { store, deps } = world();
		series(store, "FREQ=WEEKLY;COUNT=2", { id: "a" });
		series(store, null, { id: "plain" });
		series(store, "FREQ=YEARLY", { id: "bad" });
		series(store, "FREQ=WEEKLY;COUNT=3", { id: "b" });
		for (let i = 0; i < 3; i++) await tick(deps, T0 + i * 600_000);
		expect(dates(store, "a")).toHaveLength(2);
		expect(dates(store, "b")).toHaveLength(3);
		expect(dates(store, "plain")).toEqual([]);
		expect(dates(store, "bad")).toEqual([]);
	});

	it("EV-FR-17 pages through more configs than one query returns", async () => {
		const { store, kv, deps } = world();
		for (let i = 0; i < 101; i++) series(store, null, { id: `p${String(i).padStart(3, "0")}` });
		series(store, "FREQ=WEEKLY;COUNT=2", { id: "late" });
		for (let i = 0; i < 4; i++) await tick(deps, T0);
		expect(dates(store, "late")).toHaveLength(2);
		// Back to the first page once the last one is idle.
		for (let i = 0; i < 4; i++) await tick(deps, T0);
		expect(kv.values.size).toBeLessThanOrEqual(1);
	});
});
