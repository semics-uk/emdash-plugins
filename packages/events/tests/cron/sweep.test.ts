import { beforeEach, describe, expect, it } from "vitest";

import {
	expireHoldTask,
	runCron,
	SWEEP_MORE_TASK,
	SWEEP_SCHEDULE,
	SWEEP_STATE_KEY,
	SWEEP_TASK,
	type SweepDeps,
	type SweepState,
	type SweepStorage,
	scheduleHoldTask,
	scheduleSweeper,
	sweepHolds,
} from "../../src/cron/sweep";
import { FakeCron, FakeKv, makeStore, meter } from "../domain/fake-storage";

const MIN = 60_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();

beforeEach(() => {
	meter.calls = 0;
});

function world(events: Record<string, number>) {
	const storage = makeStore();
	for (const [id, reserved] of Object.entries(events)) {
		storage.event_configs.set(id, { status: "on_sale", capacity: 1000, reserved, sold: 0 });
		storage.ticket_types.set(`${id}_tt`, { eventId: id, capacity: 1000, reserved, sold: 0 });
	}
	const kv = new FakeKv();
	const cron = new FakeCron();
	const deps = (now: number, extra: Partial<SweepDeps> = {}): SweepDeps => ({
		storage: storage as unknown as SweepStorage,
		kv,
		cron,
		now,
		...extra,
	});
	return { storage, kv, cron, deps };
}

const booking = (eventId: string, n: number, data: Record<string, unknown> = {}) => ({
	ref: `${eventId}-${n}`,
	eventId,
	status: "held",
	holdExpiresAt: at(-1),
	holdCeilingAt: at(45),
	lines: [{ ticketTypeId: `${eventId}_tt`, qty: 1, unitPriceMinor: 0 }],
	createdAt: at(-16),
	...data,
});

describe("sweep-holds (EV-FR-06, R22, R23)", () => {
	it("EV-FR-06 an expired hold is released within one sweep, and the report counts every call", async () => {
		const w = world({ e1: 1 });
		w.storage.bookings.set("b1", booking("e1", 1));
		const report = await sweepHolds(w.deps(T0));
		expect(report).toMatchObject({ expired: 1, backlog: 0, continued: false });
		expect(report.calls).toBe(meter.calls);
		expect(report.calls).toBeLessThanOrEqual(8);
		expect(w.storage.bookings.docs.get("b1")?.status).toBe("expired");
		expect(w.storage.event_configs.docs.get("e1")).toMatchObject({ reserved: 0 });
	});

	it("R22 a sweep batch stays within budget; a backlog schedules a continuation and drains", async () => {
		const w = world({ e1: 15, e2: 6 });
		for (let n = 0; n < 15; n++) w.storage.bookings.set(`a${n}`, booking("e1", n, { holdExpiresAt: at(-60 + n) }));
		for (let n = 0; n < 6; n++) w.storage.bookings.set(`b${n}`, booking("e2", n, { holdExpiresAt: at(-30 + n) }));
		let ticks = 0;
		for (; ticks < 30; ticks++) {
			const before = meter.calls;
			const report = await sweepHolds(w.deps(T0 + ticks * MIN));
			expect(report.calls).toBe(meter.calls - before);
			expect(report.calls).toBeLessThanOrEqual(8);
			if (ticks === 0) {
				expect(report.continued).toBe(true);
				expect(w.cron.tasks.get(SWEEP_MORE_TASK)?.schedule).toBe(at(0));
			}
			if (report.backlog === 0 && report.expired === 0) break;
		}
		expect([...w.storage.bookings.docs.values()].every((b) => b.status === "expired")).toBe(true);
		expect(w.storage.event_configs.docs.get("e1")).toMatchObject({ reserved: 0 });
		expect(w.storage.event_configs.docs.get("e2")).toMatchObject({ reserved: 0 });
	});

	it("R22 a booking too big to share a tick still goes, without a continuation call", async () => {
		const w = world({ e1: 10 });
		w.storage.occurrences.set("occ", { eventId: "e1", capacity: 100, reserved: 10, sold: 0 });
		w.storage.ticket_types.set("e1_vip", { eventId: "e1", capacity: 100, reserved: 0, sold: 0 });
		const lines = [
			{ ticketTypeId: "e1_tt", qty: 1, unitPriceMinor: 0 },
			{ ticketTypeId: "e1_vip", qty: 1, unitPriceMinor: 0 },
		];
		w.storage.bookings.set("big", booking("e1", 1, { lines: lines.slice(0, 1), occurrenceId: "occ" }));
		w.storage.bookings.set("big2", booking("e1", 2, { lines, holdExpiresAt: at(-0.5) }));
		const report = await sweepHolds(w.deps(T0));
		expect(report.calls).toBeLessThanOrEqual(8);
		expect(report).toMatchObject({ expired: 1, continued: false, backlog: 1 });
	});

	it("R23 sweep is resumable across runs: the repair cursor and queue live in KV", async () => {
		const w = world({ big: 3, small: 0 });
		for (let n = 0; n < 240; n++) w.storage.bookings.set(`k${n}`, booking("big", n, { holdExpiresAt: at(30) }));
		w.storage.event_configs.set("closed", { status: "closed", capacity: 10, reserved: 9, sold: 0 });
		const states: SweepState[] = [];
		for (let tick = 0; tick < 10; tick++) {
			const before = meter.calls;
			const report = await sweepHolds(w.deps(T0 + tick * 5 * MIN));
			expect(report.calls).toBe(meter.calls - before);
			expect(report.calls).toBeLessThanOrEqual(8);
			states.push(w.kv.values.get(SWEEP_STATE_KEY)?.value as SweepState);
			if (w.storage.event_configs.docs.get("big")?.reserved === 240) break;
		}
		expect(states[0]).toMatchObject({ repair: { eventId: "big", cursor: expect.any(String) }, queue: ["small"] });
		expect(w.storage.event_configs.docs.get("big")).toMatchObject({ reserved: 240 });
		expect(w.storage.ticket_types.docs.get("big_tt")).toMatchObject({ reserved: 240 });
		// Events that cannot sell are not on the rolling pass.
		expect(w.storage.event_configs.docs.get("closed")).toMatchObject({ reserved: 9 });
	});

	it("R3 events an expiry left uncertain are repaired first, and conflicts are retried", async () => {
		const w = world({ e1: 0, e2: 5 });
		// A stale claim: closed without releasing, so e2's counters need repair.
		w.storage.bookings.set("s", booking("e2", 1, { releaseClaimedAt: at(-10) }));
		const first = await sweepHolds(w.deps(T0));
		expect(first).toMatchObject({ closed: 1 });
		for (let tick = 1; tick < 4; tick++) await sweepHolds(w.deps(T0 + tick * MIN));
		expect(w.storage.event_configs.docs.get("e2")).toMatchObject({ reserved: 0 });

		// A counter that moves during the repair makes it conflict; the event stays dirty.
		w.storage.event_configs.set("e2", { status: "on_sale", capacity: 1000, reserved: 7, sold: 0 });
		w.kv.values.clear();
		await w.kv.compareAndSet(SWEEP_STATE_KEY, null, { dirty: ["e2"] });
		w.storage.event_configs.beforeUpdate = (id) => {
			const d = w.storage.event_configs.docs.get(id);
			if (d) w.storage.event_configs.docs.set(id, { ...d, reserved: (d.reserved as number) + 1 });
		};
		const r = await sweepHolds(w.deps(T0 + 10 * MIN));
		expect(r.conflicted).toBeGreaterThan(0);
		expect((w.kv.values.get(SWEEP_STATE_KEY)?.value as SweepState).dirty).toContain("e2");
	});

	it("R23 an idle sweep with nothing to sell reads and stops; without a cron it never continues", async () => {
		const w = world({});
		const idle = await sweepHolds(w.deps(T0));
		expect(idle).toMatchObject({ expired: 0, repaired: 0 });
		expect(idle.calls).toBe(meter.calls);
		const v = world({ e1: 12 });
		for (let n = 0; n < 12; n++) v.storage.bookings.set(`a${n}`, booking("e1", n));
		const report = await sweepHolds(v.deps(T0, { cron: undefined }));
		expect(report).toMatchObject({ continued: false });
		expect(report.backlog).toBeGreaterThan(0);
	});
});

describe("hold-<ref> one-shots (EV-FR-06, R23)", () => {
	it("EV-FR-06 a one-shot expires its lapsed booking within budget", async () => {
		const w = world({ e1: 1 });
		w.storage.bookings.set("b1", booking("e1", 1));
		expect(await expireHoldTask(w.deps(T0), "b1")).toBe("expired");
		expect(meter.calls).toBeLessThanOrEqual(8);
		expect(w.storage.event_configs.docs.get("e1")).toMatchObject({ reserved: 0 });
		// Fired again (a retry): nothing left to do.
		expect(await expireHoldTask(w.deps(T0), "b1")).toBe("ignored");
		expect(await expireHoldTask(w.deps(T0), "missing")).toBe("ignored");
	});

	it("R23 a one-shot for an extended hold re-arms; a stale claim is closed and marked dirty", async () => {
		const w = world({ e1: 1 });
		w.storage.bookings.set("b1", booking("e1", 1, { holdExpiresAt: at(20) }));
		expect(await expireHoldTask(w.deps(T0), "b1")).toBe("rearmed");
		expect(w.cron.tasks.get("hold-e1-1")).toEqual({ schedule: at(20), data: { bookingId: "b1" } });
		expect(await expireHoldTask(w.deps(T0, { cron: undefined }), "b1")).toBe("ignored");
		w.storage.bookings.set("b2", booking("e1", 2, { releaseClaimedAt: at(-5) }));
		expect(await expireHoldTask(w.deps(T0), "b2")).toBe("closed");
		expect((w.kv.values.get(SWEEP_STATE_KEY)?.value as SweepState).dirty).toEqual(["e1"]);
	});

	it("EV-FR-06 the cron hook dispatches by name; activation schedules the */5 sweeper", async () => {
		const w = world({ e1: 2 });
		w.storage.bookings.set("b1", booking("e1", 1));
		w.storage.bookings.set("b2", booking("e1", 2));
		const ctx = { storage: w.storage, kv: w.kv, cron: w.cron } as never;
		await runCron({ name: SWEEP_TASK }, ctx, () => T0);
		expect(w.storage.bookings.docs.get("b1")?.status).toBe("expired");
		await runCron({ name: "hold-e1-2", data: { bookingId: "b2" } }, ctx, () => T0);
		expect(w.storage.bookings.docs.get("b2")?.status).toBe("expired");
		await runCron({ name: "hold-x" }, ctx, () => T0);
		await runCron({ name: "unknown" }, { storage: w.storage, kv: w.kv } as never);
		await scheduleSweeper(ctx);
		expect(w.cron.tasks.get(SWEEP_TASK)).toEqual({ schedule: SWEEP_SCHEDULE });
		await scheduleHoldTask(w.cron, { id: "b9", ref: "R 9", holdExpiresAt: at(15) });
		expect(w.cron.tasks.get("hold-R_9")).toEqual({ schedule: at(15), data: { bookingId: "b9" } });
	});
});
