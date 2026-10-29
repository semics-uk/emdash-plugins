import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// What the booking form's day-then-time picker reads (T130, EV-FR-17, R22), in workerd: `public/event`
// answers a slot schedule's upcoming open slots from `from` (up to two pages of 100, then `more`), with
// places left, closed slots left out, within the call budget; `config/get` lists upcoming slots too.

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const TARGET = { calls: 8 };
const DAY = 864e5;
type Occ = { id: string; startsAt: string; available: number };
type EventBody = { ok: boolean; slots?: boolean; more?: boolean; occurrences: Occ[] };

async function setup() {
	runtime = await createPluginRuntimeTestHost({ site: { name: "Range", url: "https://site.test" } });
	await runtime.fixtures.collection({
		slug: "events",
		label: "Events",
		fields: [
			{ slug: "title", label: "Title", type: "string" },
			{ slug: "starts_at", label: "Starts", type: "datetime" },
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
		config: {
			status: "on_sale",
			capacity: 5000,
			currency: "GBP",
			schedule: { days: ["MO"], times: ["09:00"], durationMinutes: 60, capacity: 8, bookAheadDays: 1 },
		},
		ticketTypes: [{ name: "Lane", priceMinor: 0, capacity: 5000 }],
		occurrences: [],
	})) as { ok: boolean };
	expect(saved.ok).toBe(true);
	return { r: runtime, id: entry.id, budget: withBudget(runtime) };
}

/** Slots every hour from the next whole hour (`count` of them), plus `past` ones before now. */
async function seedSlots(r: PluginRuntimeTestHost, id: string, count: number, past = 0, over: Record<number, object> = {}) {
	const base = Math.ceil(Date.now() / 36e5) * 36e5 + 36e5;
	for (let i = -past; i < count; i++) {
		// Past ones end at least an hour before now (base - 2 h).
		const t = base + (i < 0 ? i - 1 : i) * 36e5;
		await r.fixtures.plugin.storage("occurrences", `s-${id}-${t.toString(36)}`, {
			eventId: id,
			startsAt: new Date(t).toISOString(),
			capacity: 8,
			reserved: 0,
			sold: 0,
			status: "open",
			...over[i],
		});
	}
	return base;
}

describe("public/event for the day-then-time picker (T130, EV-FR-17)", () => {
	it("EV-FR-17 R22 answers up to 200 upcoming slots from `from` with `more`, slots flag and places, within budget", async () => {
		const { r, id, budget } = await setup();
		const base = await seedSlots(r, id, 230, 120, { 1: { reserved: 8 }, 2: { reserved: 3 }, 3: { status: "closed" } });

		const res = await budget.invokeRoute("public/event", { eventId: id });
		expectWithinBudget(res, TARGET);
		const body = res.value as EventBody;
		expect(body).toMatchObject({ ok: true, slots: true, more: true });
		expect(body.occurrences).toHaveLength(200);
		expect(Date.parse(body.occurrences[0]?.startsAt ?? "")).toBe(base);
		// Full shows as 0 places, a closed slot is not listed at all.
		expect(body.occurrences.slice(0, 3).map((o) => [Date.parse(o.startsAt) - base, o.available])).toEqual([
			[0, 8],
			[36e5, 0],
			[2 * 36e5, 5],
		]);
		expect(body.occurrences.some((o) => Date.parse(o.startsAt) === base + 3 * 36e5)).toBe(false);
		expect(body.occurrences.every((o) => Date.parse(o.startsAt) >= Date.now() - 60_000)).toBe(true);

		// A later page: from a given instant, and the last page has no `more`.
		const from = new Date(base + 100 * 36e5).toISOString();
		const page = (await budget.invokeRoute("public/event", { eventId: id, from })).value as EventBody;
		expect(page.occurrences[0]?.startsAt).toBe(from);
		expect(page.occurrences).toHaveLength(130);
		expect(page.more).toBeUndefined();
	});

	it("EV-FR-17 a `from` in the past, or malformed, still answers only upcoming slots", async () => {
		const { r, id, budget } = await setup();
		const base = await seedSlots(r, id, 5, 10);
		for (const from of [new Date(Date.now() - 30 * DAY).toISOString(), "nonsense", 42]) {
			const res = await budget.invokeRoute("public/event", { eventId: id, from });
			expectWithinBudget(res, TARGET);
			const body = res.value as EventBody;
			expect(body.occurrences.map((o) => Date.parse(o.startsAt))).toEqual([0, 1, 2, 3, 4].map((i) => base + i * 36e5));
			expect(body.more).toBeUndefined();
		}
	});

	it("EV-FR-17 config/get lists a slot schedule's upcoming slots, not its oldest 100 (R94 follow-up)", async () => {
		const { r, id, budget } = await setup();
		const base = await seedSlots(r, id, 3, 110);
		const res = await budget.invokeRoute("config/get", { eventId: id });
		expectWithinBudget(res, TARGET);
		const got = (res.value as { occurrences: Array<{ startsAt: string }> }).occurrences;
		expect(got.map((o) => Date.parse(o.startsAt))).toEqual([base, base + 36e5, base + 2 * 36e5]);
	});
});
