import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// Slot schedules in the shipped core, in workerd (EV-FR-17, T129, R22): `config/save` keeps the
// schedule (never with a recurrence), the `occurrences` cron makes the slots within 8 bridge calls and
// the CPU budget, `public/event` offers the upcoming ones, checkout sells them under the usual ticket
// and capacity rules, and the editor panel edits the schedule and closes, reopens or re-sizes the
// slots of one day (refusing to close a booked one, with its bookings listed).

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const TARGET = { calls: 8 };
type Doc = Record<string, unknown>;
type Row = { id: string; data: Doc };
const meta = { meta: { ip: "203.0.113.7", userAgent: null, referer: null, geo: null } };
const EVERY_DAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const SIX = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"];

async function setup(schedule: Doc | null, extra: Doc = {}) {
	runtime = await createPluginRuntimeTestHost({ site: { name: "Range", url: "https://site.test" } });
	await runtime.fixtures.collection({
		slug: "events",
		label: "Events",
		fields: [
			{ slug: "title", label: "Title", type: "string" },
			{ slug: "starts_at", label: "Starts", type: "datetime" },
			{ slug: "ends_at", label: "Ends", type: "datetime" },
			{ slug: "timezone", label: "Timezone", type: "string" },
		],
	});
	const entry = await runtime.fixtures.content("events", {
		slug: "range",
		status: "published",
		data: { title: "Range sessions", starts_at: new Date().toISOString(), timezone: "UTC" },
	});
	const saved = (await runtime.transport.invokeRoute("config/save", {
		eventId: entry.id,
		config: { status: "on_sale", capacity: 5000, currency: "GBP", ...(schedule ? { schedule } : {}), ...extra },
		ticketTypes: [{ name: "Lane", priceMinor: 0, capacity: 5000 }],
		occurrences: [],
	})) as { ok: boolean; issues?: unknown };
	return { r: runtime, id: entry.id, saved, budget: withBudget(runtime) };
}

const slots = async (r: PluginRuntimeTestHost) =>
	((await r.inspect.storage.list("occurrences")) as Row[]).sort((a, b) =>
		String(a.data.startsAt) < String(b.data.startsAt) ? -1 : 1,
	);

async function cron(budget: ReturnType<typeof withBudget>) {
	const res = await budget.invokeHook("cron", { name: "occurrences", scheduledAt: new Date().toISOString() });
	expectWithinBudget(res, TARGET);
	return res;
}

const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const text = (v: unknown) => JSON.stringify(v);

describe("slot schedules in the shipped core (EV-FR-17)", () => {
	it("EV-FR-17 config/save refuses a schedule beside a recurrence, and an invalid one", async () => {
		const { saved } = await setup(
			{ days: ["MO"], times: ["09:00"], durationMinutes: 60, capacity: 4 },
			{ recurrence: "FREQ=WEEKLY" },
		);
		expect(saved).toMatchObject({ ok: false, issues: [{ path: "config.schedule", code: "INVALID_SCHEDULE" }] });
	});

	it("EV-FR-17 the cron makes 6 slots a day for 90 days within 8 calls and the CPU budget each tick", async () => {
		const { r, id, saved, budget } = await setup({
			days: EVERY_DAY,
			times: SIX,
			durationMinutes: 60,
			capacity: 8,
			bookAheadDays: 90,
		});
		expect(saved).toMatchObject({ ok: true });
		let ticks = 0;
		for (; ticks < 15; ticks++) {
			const res = await cron(budget);
			if (res.calls.length <= 2) break;
		}
		const made = await slots(r);
		expect(made.length).toBeGreaterThanOrEqual(6 * 89);
		expect(made.length).toBeLessThanOrEqual(6 * 91);
		expect(ticks).toBeGreaterThanOrEqual(10);
		for (const s of made) expect(s.data).toMatchObject({ eventId: id, capacity: 8, status: "open" });

		// public/event offers the upcoming slots, earliest first.
		const event = (await r.transport.invokeRoute("public/event", { eventId: id })) as {
			occurrences: Array<{ id: string; startsAt: string; available: number }>;
		};
		expect(event.occurrences).toHaveLength(50);
		expect(event.occurrences[0]?.id).toBe(made.find((s) => Date.parse(String(s.data.startsAt)) >= Date.now())?.id);
	});

	it("EV-FR-17 public/event skips past slots", async () => {
		const { r, id } = await setup({ days: EVERY_DAY, times: ["09:00"], durationMinutes: 60, capacity: 8, bookAheadDays: 3 });
		for (let i = 0; i < 60; i++) {
			const t = Date.now() - (i + 1) * 864e5;
			await r.fixtures.plugin.storage("occurrences", `s-${id}-${t.toString(36)}`, {
				eventId: id,
				startsAt: new Date(t).toISOString(),
				capacity: 8,
				reserved: 0,
				sold: 0,
				status: "open",
			});
		}
		await r.transport.invokeHook("cron", { name: "occurrences", scheduledAt: new Date().toISOString() });
		const event = (await r.transport.invokeRoute("public/event", { eventId: id })) as {
			occurrences: Array<{ startsAt: string }>;
		};
		expect(event.occurrences.length).toBeGreaterThan(0);
		expect(event.occurrences.every((o) => Date.parse(o.startsAt) >= Date.now() - 60_000)).toBe(true);
	});

	it("EV-FR-17 the editor panel edits the schedule and the day view closes, reopens and re-sizes slots", async () => {
		const { r, id, budget } = await setup(null);
		const panel = await r.admin.loadEditorPanel("tickets", "events", id);
		expect(text(panel.blocks)).toContain('"sc_times"');

		const set = await budget.measure("panel save", () =>
			r.admin.submitEditorPanel("tickets", "events", id, "panel.save", {
				sc_days: "mo, tu, we, th, fr, sa, su",
				sc_times: "09:00, 18:00",
				sc_length: 60,
				sc_places: 6,
				sc_ahead: 7,
				sc_closed: "",
			}),
		);
		expectWithinBudget(set, TARGET);
		expect(text(set.value)).toContain("Saved");
		const config = (await r.inspect.storage.get("event_configs", id)) as Doc;
		expect(config.schedule).toEqual({
			days: EVERY_DAY,
			times: ["09:00", "18:00"],
			durationMinutes: 60,
			capacity: 6,
			bookAheadDays: 7,
			closedDates: [],
		});
		// Schedule events have no RRULE field and no dates of their own in the form.
		expect(text(set.value)).not.toContain('"recurrence"');
		await cron(budget);

		const day = tomorrow();
		const [morning, evening] = (await slots(r)).filter((s) => String(s.data.startsAt).startsWith(day)) as [Row, Row];
		const view = await budget.measure("day view", () =>
			r.admin.submitEditorPanel("tickets", "events", id, "panel.day", { day }),
		);
		expectWithinBudget(view, TARGET);
		expect(text(view.value)).toContain(`sl_places:${morning.id}`);
		expect(text(view.value)).toContain("09:00");

		// Someone books the evening slot.
		const ticketTypeId = ((await r.inspect.storage.list("ticket_types")) as Row[])[0]?.id;
		const held = (await r.transport.invokeRoute(
			"public/checkout/reserve",
			{
				eventId: id,
				occurrenceId: evening.id,
				lines: [{ ticketTypeId, qty: 2 }],
				buyer: { name: "Ann Booker", email: "ann@example.com" },
				idempotencyKey: `slot-key-${"s".repeat(30)}`,
			},
			meta,
		)) as { ok: boolean; bookingRef: string };
		expect(held.ok).toBe(true);

		// Close the morning slot and give the evening one 4 places.
		const edit = await budget.measure("day save", () =>
			r.admin.submitEditorPanel("tickets", "events", id, "panel.day.save", {
				day,
				[`sl_open:${morning.id}`]: false,
				[`sl_places:${evening.id}`]: 4,
			}),
		);
		expectWithinBudget(edit, TARGET);
		expect(text(edit.value)).toContain("Saved");
		expect((await r.inspect.storage.get("occurrences", morning.id)) as Doc).toMatchObject({ status: "closed" });
		expect((await r.inspect.storage.get("occurrences", evening.id)) as Doc).toMatchObject({ capacity: 4, reserved: 2 });
		const after = (await r.inspect.storage.get("event_configs", id)) as { catalog: { occurrences: Record<string, Doc> } };
		expect(after.catalog.occurrences[morning.id]).toMatchObject({ status: "closed" });
		expect(after.catalog.occurrences[evening.id]).toMatchObject({ capacity: 4 });

		// A closed slot is not sold.
		const refused = (await r.transport.invokeRoute(
			"public/checkout/reserve",
			{
				eventId: id,
				occurrenceId: morning.id,
				lines: [{ ticketTypeId, qty: 1 }],
				buyer: { name: "Bo Booker", email: "bo@example.com" },
				idempotencyKey: `slot-key-${"t".repeat(30)}`,
			},
			meta,
		)) as { ok: boolean };
		expect(refused.ok).toBe(false);

		// Closing the whole day is refused because the evening slot is booked; its booking is listed.
		const all = await budget.measure("close day", () =>
			r.admin.submitEditorPanel("tickets", "events", id, "panel.day.save", { day, day_all: "closed" }),
		);
		expectWithinBudget(all, TARGET);
		expect(text(all.value)).toContain(held.bookingRef);
		expect((await r.inspect.storage.get("occurrences", evening.id)) as Doc).toMatchObject({ status: "open" });

		// Reopen the morning slot; the cron keeps the override afterwards.
		const reopen = await r.admin.submitEditorPanel("tickets", "events", id, "panel.day.save", {
			day,
			[`sl_open:${morning.id}`]: true,
		});
		expect(text(reopen)).toContain("Saved");
		expect((await r.inspect.storage.get("occurrences", morning.id)) as Doc).toMatchObject({ status: "open" });
		await cron(budget);
		expect((await r.inspect.storage.get("occurrences", evening.id)) as Doc).toMatchObject({ capacity: 4 });

		// A panel save of other fields keeps every slot in the checkout catalog.
		const before = Object.keys(after.catalog.occurrences).length;
		await r.admin.submitEditorPanel("tickets", "events", id, "panel.save", { capacity: 4000 });
		const kept = (await r.inspect.storage.get("event_configs", id)) as { capacity: number; catalog: { occurrences: Doc } };
		expect(kept.capacity).toBe(4000);
		expect(Object.keys(kept.catalog.occurrences)).toHaveLength(before);
	});
});
