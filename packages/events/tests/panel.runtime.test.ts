import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// The "Tickets & booking" editor panel against the real plugin in workerd (EV-US-1, T043): the host
// validates every Block Kit response and attaches the saved entry's identity.

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const host = () => runtime as PluginRuntimeTestHost;
const PANEL = "tickets";
const FIELDS = [
	{ slug: "title", label: "Title", type: "string" },
	{ slug: "starts_at", label: "Starts", type: "datetime" },
	{ slug: "timezone", label: "Timezone", type: "string" },
] as const;

type Doc = Record<string, unknown>;
type Row = { id: string; data: Doc };
const text = (blocks: unknown) => JSON.stringify(blocks);

async function setup(configured = true) {
	runtime = await createPluginRuntimeTestHost({ site: { name: "Hall", url: "https://site.test" } });
	await runtime.fixtures.collection({ slug: "events", label: "Events", fields: [...FIELDS] });
	const entry = await runtime.fixtures.content("events", {
		slug: "gala",
		status: "published",
		data: { title: "Winter Gala", starts_at: "2099-12-01T19:00:00.000Z", timezone: "Europe/London" },
	});
	if (configured) {
		const saved = (await runtime.transport.invokeRoute("config/save", {
			eventId: entry.id,
			config: { status: "on_sale", capacity: 100, currency: "GBP" },
			ticketTypes: [
				{ name: "Adult", priceMinor: 1500, capacity: 60 },
				{ name: "Child", priceMinor: 500, capacity: 20, sort: 1 },
			],
			occurrences: [{ startsAt: "2099-12-01T19:00:00.000Z", capacity: 50 }],
		})) as { ok: boolean };
		expect(saved.ok).toBe(true);
	}
	return { r: host(), id: entry.id, budget: withBudget(host()) };
}

const rows = (name: string) => host().inspect.storage.list<Doc>(name) as Promise<Row[]>;
const idOf = async (name: string, key: string, value: unknown) =>
	(await rows(name)).find((i) => i.data[key] === value)?.id as string;

describe("EV-US-1 editor panel", () => {
	it("EV-US-1 loads on a saved event entry and renders the form", async () => {
		const { r, id } = await setup();
		const res = await r.admin.loadEditorPanel(PANEL, "events", id);
		const out = text(res.blocks);
		expect(out).toContain("Adult");
		expect(out).toContain("Child");
		expect(res.blocks?.some((b: { type: string }) => b.type === "form")).toBe(true);
	});

	it("EV-US-1 stats show reserved and sold from the counters", async () => {
		const { r, id } = await setup();
		const adult = await idOf("ticket_types", "name", "Adult");
		await r.fixtures.plugin.storage("ticket_types", adult, {
			eventId: id,
			name: "Adult",
			priceMinor: 1500,
			capacity: 60,
			reserved: 14,
			sold: 9,
			hidden: false,
			sort: 0,
		});
		await r.fixtures.plugin.storage("event_configs", id, {
			status: "on_sale",
			capacity: 100,
			reserved: 14,
			sold: 9,
			currency: "GBP",
			questions: [],
			signature: { required: false, mode: "each_attendee" },
			waitlistEnabled: false,
		});
		const res = await r.admin.loadEditorPanel(PANEL, "events", id);
		const statsBlock = res.blocks?.find((b: { type: string }) => b.type === "stats") as {
			items: Array<{ label: string; value: string | number }>;
		};
		const byLabel = Object.fromEntries(statsBlock.items.map((i) => [i.label, String(i.value)]));
		expect(byLabel).toMatchObject({ Sold: "9", Held: "5", Remaining: "86", Capacity: "100" });
		const meterBlock = res.blocks?.find((b: { type: string }) => b.type === "meter") as { value: number; max: number };
		expect(meterBlock).toMatchObject({ value: 9, max: 100 });
	});

	it("EV-US-1 saving the panel persists the config and writes only the changed items", async () => {
		const { r, id } = await setup();
		const adult = await idOf("ticket_types", "name", "Adult");
		const child = await idOf("ticket_types", "name", "Child");
		const res = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", {
			status: "paused",
			capacity: 120,
			[`tt_name:${adult}`]: "Adult",
			[`tt_price:${adult}`]: "16.50",
			[`tt_capacity:${adult}`]: 60,
			[`tt_name:${child}`]: "Child",
			[`tt_price:${child}`]: "5.00",
			[`tt_capacity:${child}`]: 20,
		});
		expect(text(res.blocks)).toContain("Saved");
		const config = await r.inspect.storage.get<Doc>("event_configs", id);
		expect(config).toMatchObject({ status: "paused", capacity: 120 });
		expect(await r.inspect.storage.get<Doc>("ticket_types", adult)).toMatchObject({ priceMinor: 1650, capacity: 60 });
		expect(await r.inspect.storage.get<Doc>("ticket_types", child)).toMatchObject({ priceMinor: 500 });
		// Managed fields survive: the catalog follows the new price.
		expect(JSON.stringify((config as Doc).catalog)).toContain("1650");
		expect((config as Doc).info).toMatchObject({ title: "Winter Gala" });
	});

	it("EV-US-1 adds and removes ticket types", async () => {
		const { r, id } = await setup();
		const child = await idOf("ticket_types", "name", "Child");
		const res = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", {
			[`tt_remove:${child}`]: true,
			newTickets: [{ name: "VIP", price: "40.00", capacity: 10 }],
		});
		expect(text(res.blocks)).toContain("Saved");
		expect(text(res.blocks)).toContain("VIP");
		const names = (await rows("ticket_types")).map((i) => i.data.name).sort();
		expect(names).toEqual(["Adult", "VIP"]);
	});

	it("EV-US-1 adds, edits and removes occurrences in the event's time zone", async () => {
		const { r, id } = await setup();
		const occ = await idOf("occurrences", "capacity", 50);
		const res = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", {
			[`oc_start:${occ}`]: "2099-12-02 20:30",
			[`oc_capacity:${occ}`]: 40,
			newDates: [{ startsAt: "2099-07-01 19:00", capacity: 30 }],
		});
		expect(text(res.blocks)).toContain("Saved");
		const all = await rows("occurrences");
		// 2099-12-02 is GMT, 2099-07-01 is BST (UTC+1).
		expect(all.map((i) => i.data.startsAt).sort()).toEqual(["2099-07-01T18:00:00.000Z", "2099-12-02T20:30:00.000Z"]);
		expect(all.find((i) => i.id === occ)?.data.capacity).toBe(40);
		const gone = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", { [`oc_remove:${occ}`]: true });
		expect(text(gone.blocks)).toContain("Saved");
		expect((await rows("occurrences")).length).toBe(1);
	});

	it("EV-US-1 refuses a capacity below what is reserved and removing an item in use", async () => {
		const { r, id } = await setup();
		const adult = await idOf("ticket_types", "name", "Adult");
		const occ = await idOf("occurrences", "capacity", 50);
		await r.fixtures.plugin.storage("ticket_types", adult, {
			eventId: id,
			name: "Adult",
			priceMinor: 1500,
			capacity: 60,
			reserved: 30,
			sold: 20,
			hidden: false,
			sort: 0,
		});
		await r.fixtures.plugin.storage("occurrences", occ, {
			eventId: id,
			startsAt: "2099-12-01T19:00:00.000Z",
			capacity: 50,
			reserved: 25,
			sold: 25,
			status: "open",
		});
		const save = (values: Record<string, unknown>) =>
			r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", values);
		expect(text((await save({ [`tt_capacity:${adult}`]: 10 })).blocks)).toContain("Capacity cannot be lower");
		expect(text((await save({ [`oc_capacity:${occ}`]: 5 })).blocks)).toContain("Capacity cannot be lower");
		expect(text((await save({ [`tt_remove:${adult}`]: true })).blocks)).toContain("already has bookings");
		expect(text((await save({ [`oc_remove:${occ}`]: true })).blocks)).toContain("already has bookings");
		expect(await r.inspect.storage.get<Doc>("ticket_types", adult)).toMatchObject({ capacity: 60, reserved: 30 });
	});

	it("EV-US-1 a bad date is explained, not saved", async () => {
		const { r, id } = await setup();
		const res = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", {
			newDates: [{ startsAt: "next friday", capacity: 5 }],
		});
		expect(text(res.blocks)).toContain("Not saved");
		expect(text(res.blocks)).toContain("date");
		expect((await rows("occurrences")).length).toBe(1);
	});

	it("EV-US-1 an entry without booking settings can enable them", async () => {
		const { r, id } = await setup(false);
		const first = await r.admin.loadEditorPanel(PANEL, "events", id);
		expect(text(first.blocks)).toContain("Enable");
		const res = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.enable", {
			capacity: 80,
			currency: "GBP",
		});
		expect(text(res.blocks)).toContain("Saved");
		expect(await r.inspect.storage.get<Doc>("event_configs", id)).toMatchObject({ status: "draft", capacity: 80 });
		const again = await r.admin.loadEditorPanel(PANEL, "events", id);
		expect(text(again.blocks)).toContain("Sales status");
	});

	it("EV-US-1 load and save stay within the bridge-call budget", async () => {
		const { r, id, budget } = await setup();
		const adult = await idOf("ticket_types", "name", "Adult");
		const load = await budget.measure("panel load", () => r.admin.loadEditorPanel(PANEL, "events", id));
		expectWithinBudget(load, { calls: 8 });
		const save = await budget.measure("panel save", () =>
			r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", {
				status: "paused",
				[`tt_price:${adult}`]: "17.00",
				newTickets: [{ name: "VIP", price: "40.00", capacity: 10 }],
				newDates: [{ startsAt: "2099-08-01 19:00", capacity: 30 }],
			}),
		);
		expectWithinBudget(save, { calls: 8 });
	});

	it("EV-US-1 too many changes at once are refused with a clear message", async () => {
		const { r, id } = await setup();
		const values: Record<string, unknown> = {
			newTickets: Array.from({ length: 3 }, (_, i) => ({ name: `T${i}`, price: "1.00", capacity: 5 })),
		};
		for (const t of ["Adult", "Child"]) {
			const tid = await idOf("ticket_types", "name", t);
			values[`tt_price:${tid}`] = "9.99";
			values[`tt_capacity:${tid}`] = 19;
		}
		const occ = await idOf("occurrences", "capacity", 50);
		values[`oc_capacity:${occ}`] = 45;
		values.newDates = [{ startsAt: "2099-08-01 19:00", capacity: 30 }];
		values.capacity = 90;
		const res = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", values);
		expect(text(res.blocks)).toContain("Too many changes");
	});

	it("EV-FR-12 Free: the waiver toggle is disabled with a banner (required waivers are Pro)", async () => {
		const { r, id } = await setup();
		const res = await r.admin.loadEditorPanel(PANEL, "events", id);
		const banners = (res.blocks ?? []).filter((b: { type: string }) => b.type === "banner");
		expect(text(banners)).toMatch(/waiver/i);
		expect(text(res.blocks)).not.toContain("waiver_required");
	});
});

describe("EV-US-1 event titles in admin lists (T052)", () => {
	it("EV-US-1 the events and attendees lists show titles read in one batch", async () => {
		const { r, budget } = await setup();
		const events = await budget.measure("events list", () => r.admin.loadPage("/events"));
		expectWithinBudget(events, { calls: 8 });
		expect(text(events.value.blocks)).toContain("Winter Gala");
		const attendees = await r.admin.loadPage("/attendees");
		expect(text(attendees.blocks)).toContain("Winter Gala");
	});
});

describe("EV-FR-17 editor panel recurrence", () => {
	it("EV-FR-17 sets and clears the rule, and explains a refused one", async () => {
		const { r, id } = await setup();
		const refused = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", { recurrence: "FREQ=HOURLY" });
		expect(text(refused.blocks)).toContain("Not saved");
		expect(text(refused.blocks)).toContain("(config.recurrence)");
		const saved = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", {
			recurrence: "FREQ=MONTHLY;BYDAY=1FR",
		});
		expect(text(saved.blocks)).toContain("Saved");
		expect((await rows("event_configs")).find((c) => c.id === id)?.data.recurrence).toBe("FREQ=MONTHLY;BYDAY=1FR");
		const cleared = await r.admin.submitEditorPanel(PANEL, "events", id, "panel.save", { recurrence: "" });
		expect(text(cleared.blocks)).toContain("Saved");
		expect((await rows("event_configs")).find((c) => c.id === id)?.data.recurrence ?? null).toBeNull();
	});
});
