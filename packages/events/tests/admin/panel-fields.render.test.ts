import { formFields, renderBlocks, undrawnFields } from "@semics-tech/shared/testing/blocks";
import { beforeEach, describe, expect, it } from "vitest";

import { type AdminDeps, type AdminStorage, handleAdmin } from "../../src/admin/pages";
import { handlePanel, type PanelDeps } from "../../src/admin/panel";
import { MAX_OCCURRENCES, MAX_TICKET_TYPES } from "../../src/domain/config";
import { makeStore, meter } from "../domain/fake-storage";

// T141 (R92): every field the "Tickets & booking" panel and the Event editor page put in a form must be
// one the admin's renderer draws. `FormBlockComponent` in `@emdash-cms/blocks` draws each field through
// `renderElement`, which returns null for a `repeater`: the panel's "New ticket types" and "New dates"
// repeaters were invisible on LMSC staging, so no event could get a price. New ticket types and dates
// are now one blank row of plain fields each, added on save.

const EVENT = "ev1";
type Doc = Record<string, unknown>;
type Block = { type: string; block_id?: string; [key: string]: unknown };

beforeEach(() => {
	meter.calls = 0;
});

const BASE_CONFIG: Doc = {
	status: "on_sale",
	capacity: 100,
	reserved: 0,
	sold: 0,
	currency: "GBP",
	questions: [],
	signature: { required: false, mode: "each_attendee" },
	waitlistEnabled: false,
	info: { title: "Gala", timezone: "Europe/London" },
};

const SCHEDULE = {
	days: ["mo", "tu"],
	times: ["09:00"],
	durationMinutes: 60,
	capacity: 6,
	bookAheadDays: 7,
	closedDates: [],
};

function world({ config = {}, tickets = 1, dates = 1 }: { config?: Doc; tickets?: number; dates?: number } = {}) {
	const s = makeStore();
	const ticketCatalog: Doc = {};
	for (let i = 0; i < tickets; i++) {
		const data = {
			eventId: EVENT,
			name: `T${i}`,
			priceMinor: 1000,
			capacity: 10,
			reserved: 0,
			sold: 0,
			hidden: false,
			sort: i,
		};
		s.ticket_types.set(`tt_${i}`, data);
		ticketCatalog[`tt_${i}`] = { name: data.name, priceMinor: 1000, hidden: false, sort: i };
	}
	const occurrenceCatalog: Doc = {};
	for (let i = 0; i < dates; i++) {
		const startsAt = new Date(Date.UTC(2099, 0, 1 + i, 19)).toISOString();
		s.occurrences.set(`oc_${i}`, { eventId: EVENT, startsAt, capacity: 50, reserved: 0, sold: 0, status: "open" });
		occurrenceCatalog[`oc_${i}`] = { startsAt, status: "open" };
	}
	s.event_configs.set(EVENT, {
		...BASE_CONFIG,
		catalog: { ticketTypes: ticketCatalog, occurrences: occurrenceCatalog },
		...config,
	});
	let n = 0;
	const deps: PanelDeps = {
		storage: s as unknown as PanelDeps["storage"],
		settings: { list: async () => [] },
		content: { get: async () => null },
		newId: () => `new_${n++}`,
	};
	return { s, deps };
}

const load = (deps: PanelDeps) => handlePanel(deps, { type: "panel_load" }, EVENT);
const save = (deps: PanelDeps, values: Doc, block_id?: string) =>
	handlePanel(deps, { type: "form_submit", action_id: "panel.save", values, ...(block_id ? { block_id } : {}) }, EVENT);
const ids = (blocks: unknown[]) => formFields(blocks).map((f) => f.action_id);
const formOf = (blocks: unknown[]) =>
	(blocks as Block[]).find((b) => b.type === "form" && JSON.stringify(b).includes("panel.save"));
const text = (v: unknown) => JSON.stringify(v);
const added = (s: ReturnType<typeof makeStore>, collection: "ticket_types" | "occurrences") =>
	[...s[collection].docs.entries()].filter(([id]) => id.startsWith("new_")).map(([, d]) => d);

function adminDeps(s: ReturnType<typeof makeStore>): AdminDeps {
	return {
		storage: s as unknown as AdminStorage,
		settings: { list: async () => [] },
		schema: { listCollections: async () => [] },
		now: Date.parse("2026-12-05T18:00:00.000Z"),
		pluginId: "semics-events",
		origin: "https://site.test",
		newId: () => "new_0",
	};
}

describe("R92 the panel's forms hold only fields the admin draws (T141)", () => {
	it("R92 a dated event's panel, the slot-schedule panel, the enable form and the Event editor page draw every field", async () => {
		const dated = world();
		const slots = world({ config: { schedule: SCHEDULE }, dates: 0 });
		const fresh = world();
		fresh.s.event_configs.docs.delete(EVENT);
		const forms: Array<[string, unknown[]]> = [
			["dated panel", (await load(dated.deps)).blocks],
			["slot-schedule panel", (await load(slots.deps)).blocks],
			["enable form", (await load(fresh.deps)).blocks],
			[
				"Event editor page",
				(await handleAdmin(adminDeps(dated.s), { type: "block_action", action_id: "events.edit", value: EVENT }))
					.blocks,
			],
		];
		for (const [name, blocks] of forms) {
			expect(formFields(blocks).length, name).toBeGreaterThan(0);
			expect(
				undrawnFields(blocks).map((f) => `${f.type} ${f.action_id}`),
				name,
			).toEqual([]);
		}
	});

	it("R92 the rendered panel shows the new ticket type and new date inputs", async () => {
		const html = renderBlocks((await load(world().deps)).blocks);
		expect(html).toContain("New ticket type: name");
		expect(html).toContain("New ticket type: price (GBP)");
		expect(html).toContain("New ticket type: capacity");
		expect(html).toContain("New date: starts (Europe/London)");
		expect(html).toContain("New date: capacity");
	});
});

describe("R92 adding ticket types one at a time (T141)", () => {
	it("R92 the new ticket type fields save a ticket type with name, price in minor units and capacity", async () => {
		const w = world();
		const res = await save(w.deps, { nt_name: "VIP", nt_price: "40.50", nt_capacity: 8 });
		expect(text(res.blocks)).toContain("Saved");
		expect(added(w.s, "ticket_types")).toEqual([
			expect.objectContaining({ name: "VIP", priceMinor: 4050, capacity: 8 }),
		]);
		// The re-rendered panel lists it and offers a fresh blank row.
		expect(text(res.blocks)).toContain("VIP");
		const fresh = formFields(res.blocks).filter((f) => String(f.action_id).startsWith("nt_"));
		expect(fresh.map((f) => f.action_id)).toEqual(["nt_name", "nt_price", "nt_capacity"]);
		expect(fresh.every((f) => f.initial_value === undefined || f.initial_value === "")).toBe(true);
	});

	it("R92 after a save the form is a new block, so the renderer drops what was typed in the blank row", async () => {
		const w = world();
		const before = formOf((await load(w.deps)).blocks)?.block_id;
		const saved = await save(w.deps, { nt_name: "VIP", nt_price: "40.00" }, before);
		const after = formOf(saved.blocks)?.block_id;
		expect(after).toBeTruthy();
		expect(after).not.toBe(before);
		// A refused save keeps the block, so what the admin typed stays in the form.
		const refused = await save(w.deps, { nt_name: "Bad", nt_price: "lots" }, after);
		expect(text(refused.blocks)).not.toContain("Saved");
		expect(formOf(refused.blocks)?.block_id).toBe(after);
	});

	it("R92 a row without capacity takes the event's; blank fields add nothing", async () => {
		const w = world();
		await save(w.deps, { nt_name: "Door", nt_price: "5.00", nt_capacity: "" });
		expect(added(w.s, "ticket_types")).toEqual([expect.objectContaining({ name: "Door", capacity: 100 })]);
		const blank = await save(w.deps, { nt_name: "", nt_price: " ", nt_capacity: "" });
		expect(text(blank.blocks)).toContain("Nothing to save");
		expect(added(w.s, "ticket_types")).toHaveLength(1);
	});

	it("R92 the new ticket type row is gone once MAX_TICKET_TYPES is reached", async () => {
		const full = world({ tickets: MAX_TICKET_TYPES });
		expect(ids((await load(full.deps)).blocks)).not.toContain("nt_name");
		const room = world({ tickets: MAX_TICKET_TYPES - 1 });
		expect(ids((await load(room.deps)).blocks)).toContain("nt_name");
	});
});

describe("R92 adding dates one at a time (T141)", () => {
	it("R92 the new date fields save a date in the event's zone with its capacity", async () => {
		const w = world();
		const res = await save(w.deps, { nd_start: "2099-07-01 19:00", nd_capacity: 30 });
		expect(text(res.blocks)).toContain("Saved");
		expect(added(w.s, "occurrences")).toEqual([
			expect.objectContaining({ startsAt: "2099-07-01T18:00:00.000Z", capacity: 30 }),
		]);
		expect(ids(res.blocks)).toContain("nd_start");
	});

	it("R92 a date without capacity takes the event's; a blank one adds nothing", async () => {
		const w = world();
		await save(w.deps, { nd_start: "2099-07-02 19:00", nd_capacity: "" });
		expect(added(w.s, "occurrences")).toEqual([expect.objectContaining({ capacity: 100 })]);
		await save(w.deps, { nd_start: "", nd_capacity: "", capacity: 90 });
		expect(added(w.s, "occurrences")).toHaveLength(1);
	});

	it("R92 no new date row on a slot-schedule event, nor once MAX_OCCURRENCES is reached", async () => {
		const slots = world({ config: { schedule: SCHEDULE }, dates: 0 });
		expect(ids((await load(slots.deps)).blocks)).not.toContain("nd_start");
		const full = world({ dates: MAX_OCCURRENCES });
		expect(ids((await load(full.deps)).blocks)).not.toContain("nd_start");
	});
});

describe("R92 values from an older admin still parse (T141)", () => {
	it("R92 the newTickets and newDates arrays are still added", async () => {
		const w = world();
		const res = await save(w.deps, {
			newTickets: [{ name: "Old", price: "2.00", capacity: 4 }, { name: "" }],
			newDates: [{ startsAt: "2099-08-01 19:00", capacity: 9 }],
		});
		expect(text(res.blocks)).toContain("Saved");
		expect(added(w.s, "ticket_types")).toEqual([
			expect.objectContaining({ name: "Old", priceMinor: 200, capacity: 4 }),
		]);
		expect(added(w.s, "occurrences")).toEqual([expect.objectContaining({ capacity: 9 })]);
	});
});
