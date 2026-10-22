import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// Recurring events in the shipped core, in workerd (EV-FR-17, R22): the rule is saved on the config
// (refused when it is outside the subset), set from the editor panel, materialised by the
// `occurrences` cron within 8 bridge calls, sold like any other date, and an edit of the rule
// never moves or deletes a date that holds bookings.

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const TARGET = { calls: 8 };
type Doc = Record<string, unknown>;
type Row = { id: string; data: Doc };
const meta = { meta: { ip: "203.0.113.7", userAgent: null, referer: null, geo: null } };

async function setup(recurrence?: string) {
	runtime = await createPluginRuntimeTestHost({ site: { name: "Hall", url: "https://site.test" } });
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
	// A Monday evening, an hour long, starting next week (the host's clock is real time).
	const start = new Date();
	start.setUTCDate(start.getUTCDate() + ((8 - start.getUTCDay()) % 7 || 7));
	start.setUTCHours(19, 0, 0, 0);
	const entry = await runtime.fixtures.content("events", {
		slug: "quiz",
		status: "published",
		data: {
			title: "Quiz night",
			starts_at: start.toISOString(),
			ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
			timezone: "UTC",
		},
	});
	const saved = (await runtime.transport.invokeRoute("config/save", {
		eventId: entry.id,
		config: { status: "on_sale", capacity: 30, currency: "GBP", ...(recurrence ? { recurrence } : {}) },
		ticketTypes: [{ name: "Entry", priceMinor: 0, capacity: 30 }],
		occurrences: [],
	})) as { ok: boolean; issues?: unknown };
	return { r: runtime, id: entry.id, saved, budget: withBudget(runtime) };
}

const dates = async (r: PluginRuntimeTestHost) =>
	((await r.inspect.storage.list("occurrences")) as Row[]).sort((a, b) =>
		String(a.data.startsAt) < String(b.data.startsAt) ? -1 : 1,
	);

async function cron(budget: ReturnType<typeof withBudget>) {
	const res = await budget.invokeHook("cron", { name: "occurrences", scheduledAt: new Date().toISOString() });
	expectWithinBudget(res, TARGET);
	return res;
}

describe("recurring events in the shipped core (EV-FR-17)", () => {
	it("EV-FR-17 config/save refuses a rule outside the subset", async () => {
		const { saved } = await setup("FREQ=YEARLY");
		expect(saved).toMatchObject({ ok: false, issues: [{ path: "config.recurrence", code: "INVALID_RECURRENCE" }] });
	});

	it("EV-FR-17 the cron materialises the series within 8 calls, and public/event offers the dates", async () => {
		const { r, id, saved, budget } = await setup("FREQ=WEEKLY;COUNT=3");
		expect(saved).toMatchObject({ ok: true });
		await cron(budget);
		const stored = await dates(r);
		expect(stored).toHaveLength(3);
		for (const d of stored) expect(d.data).toMatchObject({ eventId: id, capacity: 30, status: "open" });
		const event = (await r.transport.invokeRoute("public/event", { eventId: id })) as {
			ok: boolean;
			occurrences?: Array<{ id: string }>;
		};
		expect(event.ok).toBe(true);
		expect(event.occurrences?.map((o) => o.id).sort()).toEqual(stored.map((d) => d.id).sort());
		// The next tick has nothing to do.
		const idle = await cron(budget);
		expect(idle.calls.length).toBeLessThanOrEqual(2);
	});

	it("EV-FR-17 the editor panel sets the rule; editing a series keeps booked occurrences", async () => {
		const { r, id, budget } = await setup();
		const panel = await r.admin.loadEditorPanel("tickets", "events", id);
		expect(JSON.stringify(panel.blocks)).toContain('"recurrence"');
		const set = await budget.measure("panel save", () =>
			r.admin.submitEditorPanel("tickets", "events", id, "panel.save", { recurrence: "FREQ=WEEKLY;COUNT=2" }),
		);
		expectWithinBudget(set, TARGET);
		expect(JSON.stringify(set.value)).toContain("Saved");
		await cron(budget);
		const [first, second] = await dates(r);
		expect(second).toBeDefined();

		// Someone books the second date.
		const ticketTypeId = ((await r.inspect.storage.list("ticket_types")) as Row[])[0]?.id;
		const held = (await r.transport.invokeRoute(
			"public/checkout/reserve",
			{
				eventId: id,
				occurrenceId: second?.id,
				lines: [{ ticketTypeId, qty: 2 }],
				buyer: { name: "Ann Booker", email: "ann@example.com" },
				idempotencyKey: `series-key-${"s".repeat(30)}`,
			},
			meta,
		)) as { ok: boolean; bookingRef: string; accessToken: string };
		expect(held.ok).toBe(true);

		// The rule moves to Tuesdays: the unbooked Monday goes, the booked one stays as it was.
		const edit = await budget.measure("panel save", () =>
			r.admin.submitEditorPanel("tickets", "events", id, "panel.save", { recurrence: "FREQ=WEEKLY;BYDAY=TU;COUNT=2" }),
		);
		expectWithinBudget(edit, TARGET);
		for (let i = 0; i < 4; i++) await cron(budget);
		const after = await dates(r);
		const kept = after.find((d) => d.id === second?.id);
		expect(kept?.data).toMatchObject({ startsAt: second?.data.startsAt, reserved: 2, capacity: 30 });
		expect(after.some((d) => d.id === first?.id)).toBe(false);
		expect(after.filter((d) => new Date(String(d.data.startsAt)).getUTCDay() === 2)).toHaveLength(2);
	});
});
