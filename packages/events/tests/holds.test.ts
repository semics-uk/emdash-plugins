import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs against tests/fixtures/inventory-probe (project "inventory"): the shipped manifest on D1, with
// probe routes that run src/cron/sweep.ts and src/domain/holds.ts with an injected clock.

let host: PluginTestHost;
beforeEach(async () => {
	host = await createPluginTestHost();
});
afterEach(async () => {
	await host.dispose();
});

/** Designs target ≤ 8 bridge calls so a log or email call never tips an invocation over 10 (R22). */
const TARGET = { calls: 8 };

type Counted = { capacity: number; reserved: number; sold: number };
type Booking = { status: string; holdExpiresAt?: string; releaseClaimedAt?: string | null };
type Report = { calls: number; expired: number; closed: number; backlog: number; continued: boolean; repaired: number };

const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const seed = (collection: string, items: Array<{ id: string; data: Record<string, unknown> }>) =>
	host.invokeRoute("probe/seed", { collection, items });
const read = async (collection: string, id: string) => (await host.storage<Counted>(collection).get(id)) as Counted;
const booking = async (id: string) => (await host.storage<Booking>("bookings").get(id)) as Booking;

const c = (capacity: number, reserved = 0, sold = 0) => ({ capacity, reserved, sold });

async function seedEvent(eventId: string, reserved: number, opts: { sold?: number; status?: string } = {}) {
	await seed("event_configs", [
		{ id: eventId, data: { status: opts.status ?? "on_sale", currency: "GBP", ...c(1000, reserved, opts.sold ?? 0) } },
	]);
	await seed("ticket_types", [
		{
			id: `${eventId}_tt`,
			data: { eventId, name: "Std", priceMinor: 0, hidden: false, sort: 0, ...c(1000, reserved, opts.sold ?? 0) },
		},
	]);
}

function bookingDoc(eventId: string, n: number, data: Partial<Record<string, unknown>> = {}) {
	return {
		ref: `${eventId}-R${n}`,
		eventId,
		status: "held",
		holdExpiresAt: at(-1),
		holdCeilingAt: at(45),
		buyer: { name: "B", email: `b${n}@example.com` },
		email: `b${n}@example.com`,
		lines: [{ ticketTypeId: `${eventId}_tt`, qty: 1, unitPriceMinor: 0 }],
		totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
		answers: {},
		accessTokenHash: "x",
		createdAt: at(-16),
		...data,
	};
}

describe("sweep-holds on D1 (EV-FR-06, EV-US-2, R1, R22, R23)", () => {
	it("EV-FR-06 an expired hold is released within one sweep, and a live hold is left alone", async () => {
		await seedEvent("e1", 3);
		await seed("bookings", [
			{ id: "b_old", data: bookingDoc("e1", 1, { lines: [{ ticketTypeId: "e1_tt", qty: 2, unitPriceMinor: 0 }] }) },
			{ id: "b_live", data: bookingDoc("e1", 2, { holdExpiresAt: at(10) }) },
		]);
		const budget = withBudget(host);
		const r = await budget.invokeRoute("probe/sweep", { now: at(0) });
		expectWithinBudget(r, TARGET);
		expect((r.value as Report).expired).toBe(1);
		expect(await booking("b_old")).toMatchObject({ status: "expired", releaseClaimedAt: at(0) });
		expect((await booking("b_live")).status).toBe("held");
		expect(await read("ticket_types", "e1_tt")).toMatchObject({ reserved: 1 });
		expect(await read("event_configs", "e1")).toMatchObject({ reserved: 1 });
		// A second sweep finds nothing to release and does not release again.
		const again = await budget.invokeRoute("probe/sweep", { now: at(1) });
		expectWithinBudget(again, TARGET);
		expect(await read("event_configs", "e1")).toMatchObject({ reserved: 1 });
	});

	it("R22 a sweep batch stays within budget, and a backlog drains over ticks with a continuation", async () => {
		await seedEvent("e1", 7);
		await seedEvent("e2", 5);
		await seed("bookings", [
			...Array.from({ length: 7 }, (_, n) => ({ id: `a${n}`, data: bookingDoc("e1", n, { holdExpiresAt: at(-30 + n) }) })),
			...Array.from({ length: 5 }, (_, n) => ({ id: `b${n}`, data: bookingDoc("e2", n, { holdExpiresAt: at(-20 + n) }) })),
		]);
		const budget = withBudget(host);
		let ticks = 0;
		let continued = false;
		for (; ticks < 20; ticks++) {
			const r = await budget.invokeRoute("probe/sweep", { now: at(ticks) });
			expectWithinBudget(r, TARGET);
			const report = r.value as Report;
			continued ||= report.continued;
			if (report.expired === 0 && report.backlog === 0) break;
		}
		const all = await host.storage<Booking>("bookings").list();
		expect(all.filter((b) => b.data.status !== "expired")).toEqual([]);
		expect(await read("event_configs", "e1")).toMatchObject({ reserved: 0 });
		expect(await read("event_configs", "e2")).toMatchObject({ reserved: 0 });
		expect(await read("ticket_types", "e1_tt")).toMatchObject({ reserved: 0 });
		expect(continued).toBe(true);
		expect(ticks).toBeGreaterThan(1);
	});

	it("R23 sweep is resumable across runs: drift repair of a large event keeps its cursor in KV", async () => {
		// 230 live bookings (3 pages) but counters drifted to 10: repair needs several ticks.
		await seedEvent("big", 10);
		const items = Array.from({ length: 230 }, (_, n) => ({
			id: `k${String(n).padStart(3, "0")}`,
			data: bookingDoc("big", n, { holdExpiresAt: at(30) }),
		}));
		for (let i = 0; i < items.length; i += 50) await seed("bookings", items.slice(i, i + 50));
		const budget = withBudget(host);
		const states: unknown[] = [];
		for (let tick = 0; tick < 6; tick++) {
			const r = await budget.invokeRoute("probe/sweep", { now: at(tick * 5) });
			expectWithinBudget(r, TARGET);
			states.push(await host.kv.get("cron:sweep-holds"));
			if ((await read("event_configs", "big")).reserved === 230) break;
		}
		// The first tick stopped mid-scan with a cursor in KV; a later one finished from it.
		expect(states[0]).toMatchObject({ repair: { eventId: "big", cursor: expect.any(String) } });
		expect(states.length).toBeGreaterThan(1);
		expect(await read("event_configs", "big")).toMatchObject({ reserved: 230 });
		expect(await read("ticket_types", "big_tt")).toMatchObject({ reserved: 230 });
	});

	it("R3 a hold-<ref> one-shot racing the sweeper releases each seat exactly once", async () => {
		await seedEvent("e1", 12);
		await seed(
			"bookings",
			Array.from({ length: 12 }, (_, n) => ({ id: `r${n}`, data: bookingDoc("e1", n, { holdExpiresAt: at(-1) }) })),
		);
		const budget = withBudget(host);
		// ≤ 16 in flight: every one-shot, plus sweeps, all at once.
		const results = await Promise.all([
			...Array.from({ length: 12 }, (_, n) => budget.invokeRoute("probe/hold-task", { bookingId: `r${n}`, now: at(0) })),
			budget.invokeRoute("probe/sweep", { now: at(0) }),
			budget.invokeRoute("probe/sweep", { now: at(0) }),
		]);
		for (const r of results) expectWithinBudget(r, TARGET);
		// Finish whatever the race left over.
		for (let tick = 1; tick < 6; tick++) await budget.invokeRoute("probe/sweep", { now: at(tick) });
		const all = await host.storage<Booking>("bookings").list();
		expect(all.every((b) => b.data.status === "expired")).toBe(true);
		expect(await read("event_configs", "e1")).toMatchObject({ reserved: 0 });
		expect(await read("ticket_types", "e1_tt")).toMatchObject({ reserved: 0 });
	});

	it("EV-US-2 a step extends the hold up to the ceiling; after a claim the hold cannot be extended", async () => {
		await seedEvent("e1", 2);
		await seed("bookings", [
			{ id: "x1", data: bookingDoc("e1", 1, { holdExpiresAt: at(10), holdCeilingAt: at(45) }) },
			// Claimed by an expirer that is still running: the claim wins over a late step.
			{ id: "x2", data: bookingDoc("e1", 2, { holdExpiresAt: at(10), releaseClaimedAt: at(0) }) },
			{ id: "x3", data: bookingDoc("e1", 3, { holdExpiresAt: at(-1) }) },
		]);
		const budget = withBudget(host);
		const ext = await budget.invokeRoute("probe/extend", { bookingId: "x1", now: at(5), until: at(120) });
		expectWithinBudget(ext, { calls: 2 });
		expect(ext.value).toMatchObject({ ok: true, value: { holdExpiresAt: at(45), atCeiling: true } });
		expect((await booking("x1")).holdExpiresAt).toBe(at(45));
		// At the ceiling a further step writes nothing.
		const again = await budget.invokeRoute("probe/extend", { bookingId: "x1", now: at(6), until: at(200) });
		expectWithinBudget(again, { calls: 1 });
		expect((await booking("x1")).holdExpiresAt).toBe(at(45));

		const claimed = await budget.invokeRoute("probe/extend", { bookingId: "x2", now: at(1), until: at(30) });
		expect(claimed.value).toMatchObject({ ok: false, error: { code: "HOLD_LAPSED" } });
		await budget.invokeRoute("probe/sweep", { now: at(0) });
		const expired = await budget.invokeRoute("probe/extend", { bookingId: "x3", now: at(1), until: at(30) });
		expect(expired.value).toMatchObject({ ok: false, error: { code: "NOT_HELD" } });
	});

	it("R23 a one-shot that fires before an extended hold lapses re-arms instead of releasing", async () => {
		await seedEvent("e1", 1);
		await seed("bookings", [{ id: "y1", data: bookingDoc("e1", 1, { holdExpiresAt: at(20) }) }]);
		const budget = withBudget(host);
		const r = await budget.invokeRoute("probe/hold-task", { bookingId: "y1", now: at(0) });
		expectWithinBudget(r, TARGET);
		expect(r.value).toEqual({ result: "rearmed" });
		expect((await booking("y1")).status).toBe("held");
		expect(await read("event_configs", "e1")).toMatchObject({ reserved: 1 });
	});
});
