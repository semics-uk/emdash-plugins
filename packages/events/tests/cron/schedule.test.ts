import { beforeEach, describe, expect, it } from "vitest";

import { type OccurrencesDeps, occurrencesTick } from "../../src/cron/occurrences";
import { SLOT_BATCH, type ScheduleDoc, slotId, slotStarts } from "../../src/domain/schedule";
import { FakeKv, makeStore, meter } from "../domain/fake-storage";

// Slot schedules in the `occurrences` cron (EV-FR-17, T129, R22): every slot inside the book-ahead
// window is generated, SLOT_BATCH a tick, within 8 bridge calls. Regeneration keeps overrides (a slot
// closed or given other places stays so) and never moves or deletes a booked slot; an unbooked slot
// the schedule no longer gives is first taken out of the catalog, then deleted a tick later.

const MIN = 60_000;
const T0 = Date.parse("2026-11-02T06:00:00.000Z"); // a Monday
const TARGET = 8;
// biome-ignore lint/suspicious/noExplicitAny: test reads loose documents
type Doc = Record<string, any>;

class Kv extends FakeKv {
	async set(key: string, value: unknown) {
		meter.calls++;
		this.values.set(key, { value: structuredClone(value), revision: "1" });
	}
}

const EVERY_DAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const SIX = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"];
const schedule = (over: Partial<ScheduleDoc> = {}): ScheduleDoc => ({
	days: EVERY_DAY,
	times: SIX,
	durationMinutes: 60,
	capacity: 12,
	bookAheadDays: 90,
	closedDates: [],
	...over,
});

function world(s: ScheduleDoc, id = "ev1") {
	const store = makeStore();
	const deps = { storage: store, kv: new Kv() } as unknown as OccurrencesDeps;
	store.event_configs.set(id, {
		status: "on_sale",
		capacity: 500,
		reserved: 0,
		sold: 0,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: false,
		schedule: s,
		catalog: { ticketTypes: { tt: { capacity: 500, priceMinor: 0, hidden: false } }, occurrences: {} },
		info: { title: "Range", startsAt: "2026-11-02T09:00:00.000Z", endsAt: null, timezone: "Europe/London", venue: null },
	});
	return { store, deps };
}

type Store = ReturnType<typeof makeStore>;
const config = (s: Store, id = "ev1") => s.event_configs.docs.get(id) as Doc;
const catalog = (s: Store, id = "ev1") => config(s, id).catalog.occurrences as Record<string, Doc>;
const docs = (s: Store) => [...s.occurrences.docs.entries()];

async function tick(deps: OccurrencesDeps, now: number) {
	meter.calls = 0;
	await occurrencesTick(deps, now);
	expect(meter.calls).toBeLessThanOrEqual(TARGET);
	return meter.calls;
}

async function fill(deps: OccurrencesDeps, now: number, max = 20) {
	for (let i = 0; i < max; i++) if ((await tick(deps, now + i * 10 * MIN)) <= 2) return i;
	throw new Error("schedule never settled");
}

beforeEach(() => {
	meter.calls = 0;
});

describe("slot schedules in the occurrences cron (EV-FR-17, R22)", () => {
	it("EV-FR-17 generates every slot inside book-ahead, SLOT_BATCH a tick, within 8 calls", async () => {
		const { store, deps } = world(schedule());
		await tick(deps, T0);
		expect(docs(store)).toHaveLength(SLOT_BATCH);
		await fill(deps, T0);
		const wanted = slotStarts(schedule(), "Europe/London", T0 + 20 * 10 * MIN).length;
		expect(Object.keys(catalog(store)).length).toBeGreaterThanOrEqual(wanted - 6);
		expect(docs(store).length).toBe(Object.keys(catalog(store)).length);
		const [id, doc] = docs(store)[0] as [string, Doc];
		expect(doc).toEqual({
			eventId: "ev1",
			startsAt: "2026-11-02T09:00:00.000Z",
			endsAt: "2026-11-02T10:00:00.000Z",
			capacity: 12,
			reserved: 0,
			sold: 0,
			status: "open",
		});
		expect(catalog(store)[id]).toEqual({ capacity: 12, startsAt: doc.startsAt, status: "open" });
		// The checkout catalog keeps the ticket types.
		expect(Object.keys(config(store).catalog.ticketTypes)).toEqual(["tt"]);
	});

	it("EV-FR-17 regeneration keeps overrides and booked slots; unbooked stale slots are unlisted, then deleted", async () => {
		const s = schedule({ times: ["09:00", "18:00"], bookAheadDays: 14 });
		const { store, deps } = world(s);
		await fill(deps, T0);
		const [closed, booked, fewer, free] = slotStarts(s, "Europe/London", T0).map((t) => slotId("ev1", t)) as [
			string,
			string,
			string,
			string,
		];
		// Overrides: one slot closed, one with 4 places; one slot holds a booking.
		store.occurrences.docs.set(closed, { ...store.occurrences.docs.get(closed), status: "closed" });
		catalog(store)[closed] = { ...catalog(store)[closed], status: "closed" };
		store.occurrences.docs.set(fewer, { ...store.occurrences.docs.get(fewer), capacity: 4 });
		catalog(store)[fewer] = { ...catalog(store)[fewer], capacity: 4 };
		store.occurrences.docs.set(booked, { ...store.occurrences.docs.get(booked), reserved: 2 });

		// Same times: nothing changes, overrides survive.
		expect(await tick(deps, T0 + 60 * MIN)).toBeLessThanOrEqual(2);
		expect(catalog(store)[closed]?.status).toBe("closed");
		expect(catalog(store)[fewer]?.capacity).toBe(4);

		// The schedule moves the evening slot to 19:00: the booked 18:00 stays, the free one is unlisted.
		config(store).schedule = { ...s, times: ["09:00", "19:00"] };
		const now = T0 + 70 * MIN;
		await tick(deps, now);
		expect(catalog(store)[booked]).toBeDefined();
		expect(catalog(store)[free]).toBeUndefined();
		expect(store.occurrences.docs.has(free)).toBe(true);
		expect(config(store).unlisted.ids).toContain(free);
		expect(catalog(store)[closed]?.status).toBe("closed");
		expect(catalog(store)[fewer]?.capacity).toBe(4);

		// After the grace period the unlisted slots are deleted; the 19:00 slots are made.
		await fill(deps, now + 10 * MIN);
		expect(store.occurrences.docs.has(free)).toBe(false);
		expect(store.occurrences.docs.get(booked)).toMatchObject({ reserved: 2, startsAt: "2026-11-02T18:00:00.000Z" });
		expect(config(store).unlisted ?? null).toBeNull();
		const evening = Object.values(catalog(store)).filter((o) => o.startsAt.endsWith("T19:00:00.000Z"));
		expect(evening.length).toBeGreaterThanOrEqual(13);
	});

	it("EV-FR-17 a slot booked while unlisted is listed again, never deleted", async () => {
		const s = schedule({ times: ["09:00", "18:00"], bookAheadDays: 7 });
		const { store, deps } = world(s);
		await fill(deps, T0);
		const late = slotId("ev1", Date.parse("2026-11-03T18:00:00.000Z"));
		config(store).schedule = { ...s, times: ["09:00"] };
		await tick(deps, T0 + 60 * MIN);
		expect(config(store).unlisted.ids).toContain(late);
		// A reservation that planned from the old catalog lands.
		store.occurrences.docs.set(late, { ...store.occurrences.docs.get(late), reserved: 1 });
		await tick(deps, T0 + 80 * MIN);
		expect(store.occurrences.docs.get(late)).toMatchObject({ reserved: 1 });
		expect(catalog(store)[late]).toMatchObject({ status: "open" });
	});

	it("EV-FR-17 closed dates and a shorter book-ahead remove the unbooked slots they leave out", async () => {
		const s = schedule({ times: ["09:00"], bookAheadDays: 14 });
		const { store, deps } = world(s);
		await fill(deps, T0);
		config(store).schedule = { ...s, bookAheadDays: 7, closedDates: ["2026-11-04"] };
		await fill(deps, T0 + 60 * MIN);
		const days = Object.values(catalog(store)).map((o) => o.startsAt.slice(0, 10));
		expect(days).not.toContain("2026-11-04");
		expect(days.every((d) => d <= "2026-11-09")).toBe(true);
		expect(docs(store).length).toBe(days.length);
	});

	it("EV-FR-17 a write that lost a race with another schedule writer is retried, and never resets counters", async () => {
		const s = schedule({ times: ["09:00"], bookAheadDays: 7 });
		const { store, deps } = world(s);
		store.event_configs.beforeUpdate = (id) => {
			const c = store.event_configs.docs.get(id) as Doc;
			store.event_configs.docs.set(id, { ...c, slotsRev: (c.slotsRev ?? 0) + 1 });
			store.event_configs.beforeUpdate = null;
		};
		await tick(deps, T0);
		expect(Object.keys(catalog(store))).toHaveLength(0);
		const [first] = docs(store)[0] as [string, Doc];
		store.occurrences.docs.set(first, { ...store.occurrences.docs.get(first), reserved: 3 });
		await tick(deps, T0 + 10 * MIN);
		expect(catalog(store)[first]).toBeDefined();
		expect(store.occurrences.docs.get(first)?.reserved).toBe(3);
	});

	it("EV-FR-17 past slots leave the catalog a week after they start; their documents stay", async () => {
		const s = schedule({ times: ["09:00"], bookAheadDays: 7 });
		const { store, deps } = world(s);
		await fill(deps, T0);
		const first = slotId("ev1", Date.parse("2026-11-02T09:00:00.000Z"));
		await fill(deps, T0 + 9 * 864e5);
		expect(catalog(store)[first]).toBeUndefined();
		expect(store.occurrences.docs.has(first)).toBe(true);
	});

	it("EV-FR-17 paging: a schedule on the second page of configs is served", async () => {
		const s = schedule({ times: ["09:00"], bookAheadDays: 3 });
		const { store, deps } = world(s, "zz");
		for (let i = 0; i < 100; i++) {
			store.event_configs.set(`a${String(i).padStart(3, "0")}`, { status: "draft", catalog: null });
		}
		// The schedule's config was added first; move it to the end of the page order.
		const doc = store.event_configs.docs.get("zz") as Doc;
		store.event_configs.docs.delete("zz");
		store.event_configs.set("zz2", doc);
		await tick(deps, T0);
		await tick(deps, T0 + 10 * MIN);
		expect(Object.keys((store.event_configs.docs.get("zz2") as Doc).catalog.occurrences).length).toBeGreaterThan(0);
	});
});
