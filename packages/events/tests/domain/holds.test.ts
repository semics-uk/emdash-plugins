import { beforeEach, describe, expect, it } from "vitest";

import {
	CLAIM_STALE_MS,
	DEFAULT_HOLD_SETTINGS,
	type ExpiringBooking,
	expireBookings,
	expiryAction,
	expiryCalls,
	extendHold,
	holdSettings,
	holdTaskName,
	planExpiries,
	planExtension,
	startHold,
	stepTarget,
} from "../../src/domain/holds";
import { mergeRefs, repairStep, restore } from "../../src/domain/inventory";
import { makeStore, meter } from "./fake-storage";

const MIN = 60_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();

beforeEach(() => {
	meter.calls = 0;
});

function held(n: number, data: Partial<ExpiringBooking> & Record<string, unknown> = {}) {
	return {
		ref: `R${n}`,
		eventId: "e1",
		status: "held" as const,
		holdExpiresAt: at(-1),
		holdCeilingAt: at(45),
		lines: [{ ticketTypeId: "tt_a", qty: 1, unitPriceMinor: 0 }],
		createdAt: at(-16),
		...data,
	};
}

function seededStore(reserved: number) {
	const s = makeStore();
	s.event_configs.set("e1", { status: "on_sale", capacity: 100, reserved, sold: 0 });
	s.ticket_types.set("tt_a", { eventId: "e1", capacity: 100, reserved, sold: 0 });
	return s;
}

describe("hold lengths (EV-FR-06, R1)", () => {
	it("R1 free holds last 15 min, paid holds 35 min, both under a 60-min ceiling from the start", () => {
		expect(startHold(T0, { paid: false })).toEqual({ holdExpiresAt: at(15), holdCeilingAt: at(60) });
		expect(startHold(T0, { paid: true })).toEqual({ holdExpiresAt: at(35), holdCeilingAt: at(60) });
		const tight = { freeMinutes: 20, paidMinutes: 40, ceilingMinutes: 15 };
		expect(startHold(T0, { paid: true }, tight).holdExpiresAt).toBe(at(15));
		expect(stepTarget(T0, { paid: false })).toBe(T0 + 15 * MIN);
		expect(stepTarget(T0, { paid: true })).toBe(T0 + 35 * MIN);
	});

	it("EV-FR-06 settings fall back to defaults and are clamped to the manifest ranges", () => {
		expect(holdSettings({})).toEqual(DEFAULT_HOLD_SETTINGS);
		expect(holdSettings({ holdMinutesFree: "10", holdMinutesPaid: Number.NaN })).toEqual(DEFAULT_HOLD_SETTINGS);
		expect(holdSettings({ holdMinutesFree: 1, holdMinutesPaid: 10, holdCeilingMinutes: 500 })).toEqual({
			freeMinutes: 5,
			paidMinutes: 30,
			ceilingMinutes: 120,
		});
		expect(holdSettings({ holdMinutesFree: 20.4 }).freeMinutes).toBe(20);
	});
});

describe("extensions (EV-US-2, R1)", () => {
	it("R1 extension never passes the ceiling and never shortens a hold", () => {
		let hold = { status: "held" as const, holdExpiresAt: at(15), holdCeilingAt: at(60) };
		let now = T0;
		// Steps at random times wanting random extensions, until the hold lapses or reaches the ceiling.
		let seed = 7;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			return seed / 2 ** 31;
		};
		for (let i = 0; i < 200; i++) {
			now += Math.floor(rand() * 5 * MIN);
			const until = now + Math.floor(rand() * 90 * MIN);
			const r = planExtension(hold, now, until);
			if (!r.ok) {
				expect(Date.parse(hold.holdExpiresAt)).toBeLessThanOrEqual(now);
				expect(r.error.code).toBe("HOLD_LAPSED");
				break;
			}
			const next = Date.parse(r.value.holdExpiresAt);
			expect(next).toBeLessThanOrEqual(Date.parse(hold.holdCeilingAt));
			expect(next).toBeGreaterThanOrEqual(Date.parse(hold.holdExpiresAt));
			expect(r.value.atCeiling).toBe(next === Date.parse(hold.holdCeilingAt));
			hold = { ...hold, holdExpiresAt: r.value.holdExpiresAt };
		}
		expect(Date.parse(hold.holdExpiresAt)).toBeLessThanOrEqual(T0 + 60 * MIN);
	});

	it("EV-US-2 a lapsed, claimed or finished hold cannot be extended", () => {
		const base = { status: "held" as const, holdExpiresAt: at(10), holdCeilingAt: at(60) };
		expect(planExtension({ ...base, holdExpiresAt: at(0) }, T0, T0 + MIN)).toEqual({
			ok: false,
			error: { code: "HOLD_LAPSED" },
		});
		expect(planExtension({ ...base, releaseClaimedAt: at(0) }, T0, T0 + MIN)).toMatchObject({
			error: { code: "HOLD_LAPSED" },
		});
		expect(planExtension({ ...base, status: "confirmed" }, T0, T0 + MIN)).toMatchObject({
			error: { code: "NOT_HELD" },
		});
		expect(planExtension({ ...base, holdExpiresAt: undefined }, T0, T0 + MIN)).toMatchObject({
			error: { code: "NOT_HELD" },
		});
		// Without a ceiling the hold cannot grow.
		expect(planExtension({ ...base, holdCeilingAt: undefined }, T0, T0 + 30 * MIN)).toMatchObject({
			ok: true,
			value: { holdExpiresAt: at(10), changed: false, atCeiling: true },
		});
	});

	it("EV-US-2 extendHold writes once, guarded on the read hold and an unclaimed booking", async () => {
		const s = seededStore(1);
		s.bookings.set("b1", held(1, { holdExpiresAt: at(10) }));
		const booking = (await s.bookings.get("b1")) as ExpiringBooking;
		meter.calls = 0;
		const r = await extendHold(s.bookings, "b1", booking, T0, T0 + 30 * MIN, { status: "awaiting_payment" });
		expect(r).toEqual({ ok: true, value: { holdExpiresAt: at(30), atCeiling: false } });
		expect(meter.calls).toBe(1);
		expect(s.bookings.docs.get("b1")).toMatchObject({ status: "awaiting_payment", holdExpiresAt: at(30) });
		// The same stale read again: the guard misses.
		expect(await extendHold(s.bookings, "b1", booking, T0, T0 + 40 * MIN)).toEqual({
			ok: false,
			error: { code: "CONFLICT" },
		});
		// No change and nothing else to set: no write.
		meter.calls = 0;
		const fresh = s.bookings.docs.get("b1") as ExpiringBooking;
		expect(await extendHold(s.bookings, "b1", fresh, T0, T0)).toMatchObject({ ok: true });
		expect(meter.calls).toBe(0);
		expect(await extendHold(s.bookings, "b1", { ...fresh, status: "confirmed" }, T0, T0)).toMatchObject({ ok: false });
	});
});

describe("expiry (EV-FR-06, R3)", () => {
	it("EV-FR-06 decides what to do with each booking", () => {
		expect(expiryAction(held(1), T0)).toBe("release");
		expect(expiryAction(held(1, { holdExpiresAt: at(1) }), T0)).toBeNull();
		expect(expiryAction(held(1, { holdExpiresAt: undefined }), T0)).toBeNull();
		expect(expiryAction(held(1, { status: "confirmed" }), T0)).toBeNull();
		expect(expiryAction(held(1, { releaseClaimedAt: at(-1) }), T0)).toBeNull();
		expect(expiryAction(held(1, { releaseClaimedAt: new Date(T0 - CLAIM_STALE_MS).toISOString() }), T0)).toBe("close");
		expect(expiryAction(held(1, { releaseClaimedAt: "garbage" }), T0)).toBe("close");
		expect(expiryAction(held(1, { status: "draft" }), T0)).toBe("close");
		expect(expiryAction(held(1, { status: "draft", createdAt: at(-2) }), T0)).toBeNull();
	});

	it("R22 plans the oldest due bookings that fit the budget, merging releases per document", () => {
		const items = Array.from({ length: 6 }, (_, n) => ({ id: `b${n}`, data: held(n) }));
		items.splice(1, 0, { id: "live", data: held(9, { holdExpiresAt: at(5) }) });
		const { planned, due } = planExpiries(items, T0, 5);
		expect(due).toBe(6);
		// Two bookings: 2 claims + 2 merged releases (tt_a, e1) + 2 moves = 6 > 5, so one fits.
		expect(planned.map((p) => p.id)).toEqual(["b0"]);
		expect(expiryCalls(planned)).toBe(4);
		const wide = planExpiries(items, T0, 8);
		expect(wide.planned.map((p) => p.id)).toEqual(["b0", "b1", "b2"]);
		expect(expiryCalls(wide.planned)).toBe(8);
		expect(mergeRefs(wide.planned.flatMap((p) => p.refs))).toEqual([
			{ collection: "ticket_types", id: "tt_a", qty: 3 },
			{ collection: "event_configs", id: "e1", qty: 3 },
		]);
	});

	it("EV-FR-06 expires a batch: claims, one release per document, moves", async () => {
		const s = seededStore(3);
		for (let n = 0; n < 3; n++) s.bookings.set(`b${n}`, held(n));
		const { planned } = planExpiries(
			[...s.bookings.docs].map(([id, data]) => ({ id, data })),
			T0,
			8,
		);
		meter.calls = 0;
		const out = await expireBookings(s, planned, T0);
		expect(meter.calls).toBe(expiryCalls(planned));
		expect(out.map((o) => o.outcome)).toEqual(["expired", "expired", "expired"]);
		expect(out.some((o) => o.dirty)).toBe(false);
		expect(s.bookings.docs.get("b0")).toMatchObject({ status: "expired", expiredAt: at(0), releaseClaimedAt: at(0) });
		expect(s.event_configs.docs.get("e1")).toMatchObject({ reserved: 0 });
		expect(s.ticket_types.docs.get("tt_a")).toMatchObject({ reserved: 0 });
	});

	it("R3 two expirers racing on the same holds release each seat once", async () => {
		const s = seededStore(4);
		for (let n = 0; n < 2; n++)
			s.bookings.set(`b${n}`, held(n, { lines: [{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 0 }] }));
		const items = [...s.bookings.docs].map(([id, data]) => ({ id, data }));
		const a = planExpiries(items, T0, 8).planned;
		const b = planExpiries(items, T0, 8).planned;
		const [ra, rb] = await Promise.all([expireBookings(s, a, T0), expireBookings(s, b, T0)]);
		const outcomes = [...ra, ...rb].map((o) => o.outcome).sort();
		expect(outcomes).toEqual(["expired", "expired", "skipped", "skipped"]);
		expect(s.event_configs.docs.get("e1")).toMatchObject({ reserved: 0 });
	});

	it("R3 a move that loses a race takes the seats back (restore) and marks the event dirty", async () => {
		const s = seededStore(1);
		s.bookings.set("b0", held(0));
		// Another writer changes the status between the claim and the move.
		s.bookings.beforeUpdate = (id, args) => {
			const set = (args as { set?: { status?: string } }).set;
			if (set?.status === "expired") s.bookings.docs.set(id, { ...s.bookings.docs.get(id), status: "confirmed" });
		};
		const { planned } = planExpiries([{ id: "b0", data: s.bookings.docs.get("b0") }], T0, 8);
		const [o] = await expireBookings(s, planned, T0);
		expect(o).toMatchObject({ outcome: "restored", dirty: true });
		expect(s.event_configs.docs.get("e1")).toMatchObject({ reserved: 1 });
		expect(s.ticket_types.docs.get("tt_a")).toMatchObject({ reserved: 1 });
	});

	it("R3 stale claims and dead drafts are closed without releasing, for drift repair to settle", async () => {
		const s = seededStore(2);
		const stale = new Date(T0 - CLAIM_STALE_MS - 1).toISOString();
		s.bookings.set("claimed", held(0, { releaseClaimedAt: stale }));
		s.bookings.set("draft", held(1, { status: "draft" }));
		const items = [...s.bookings.docs].map(([id, data]) => ({ id, data }));
		const { planned } = planExpiries(items, T0, 8);
		const out = await expireBookings(s, planned, T0);
		expect(out.map((o) => [o.outcome, o.dirty])).toEqual([
			["closed", true],
			["closed", true],
		]);
		expect(s.event_configs.docs.get("e1")).toMatchObject({ reserved: 2 });
		// A second closer finds nothing left to close.
		expect((await expireBookings(s, planned, T0)).map((o) => o.outcome)).toEqual(["skipped", "skipped"]);
	});

	it("R3 a release that cannot apply (drift) still expires the booking but marks the event dirty", async () => {
		const s = seededStore(0);
		s.bookings.set("b0", held(0));
		s.bookings.set("b1", held(1));
		s.bookings.failOn = (_m, id, args) =>
			id === "b1" && (args as { set?: { releaseClaimedAt?: string } }).set?.releaseClaimedAt !== undefined;
		const { planned } = planExpiries(
			[...s.bookings.docs].map(([id, data]) => ({ id, data })),
			T0,
			8,
		);
		const out = await expireBookings(s, planned, T0);
		expect(out.map((o) => [o.id, o.outcome, o.dirty])).toEqual([
			["b0", "expired", true],
			["b1", "skipped", false],
		]);
		expect(s.event_configs.docs.get("e1")).toMatchObject({ reserved: 0 });
	});

	it("EV-FR-06 one-shot task names are valid cron names", () => {
		expect(holdTaskName("AB12-cd_3")).toBe("hold-AB12-cd_3");
		expect(holdTaskName("a b/c")).toBe("hold-a_b_c");
		expect(holdTaskName("x".repeat(300))).toHaveLength(128);
	});
});

describe("restore and resumable drift repair (R3)", () => {
	it("R3 restore adds seats back without a capacity guard", async () => {
		const s = seededStore(100);
		expect(await restore(s, [{ collection: "event_configs", id: "e1", qty: 2 }])).toEqual([]);
		expect(s.event_configs.docs.get("e1")).toMatchObject({ reserved: 102 });
		expect(await restore(s, [{ collection: "event_configs", id: "gone", qty: 1 }])).toEqual([
			{ collection: "event_configs", id: "gone", qty: 1 },
		]);
	});

	it("R3 repairStep resumes a large event across steps and writes guarded fixes", async () => {
		const s = seededStore(5);
		for (let n = 0; n < 250; n++) s.bookings.set(`k${n}`, held(n, { holdExpiresAt: at(30) }));
		s.bookings.set("old", held(999, { status: "expired" }));
		let job = { eventId: "e1" } as Parameters<typeof repairStep>[1] | null;
		const steps: number[] = [];
		while (job) {
			const r = await repairStep(s, job, T0, 4);
			expect(r.calls).toBeLessThanOrEqual(4);
			steps.push(r.calls);
			job = r.job;
			if (steps.length > 10) throw new Error("repair did not finish");
		}
		// 3 snapshot reads + page 1; pages 2 and 3, then the 2 fixes.
		expect(steps).toEqual([4, 4]);
		expect(s.event_configs.docs.get("e1")).toMatchObject({ reserved: 250 });
		expect(s.ticket_types.docs.get("tt_a")).toMatchObject({ reserved: 250 });
	});

	it("R3 repairStep waits for budget, spreads fixes, drops a deleted event and reports conflicts", async () => {
		const s = seededStore(5);
		expect(await repairStep(s, { eventId: "e1" }, T0, 2)).toMatchObject({ job: { eventId: "e1" }, calls: 0 });
		// Snapshot and the only page use the whole budget: the fixes wait for the next step.
		const scanned = await repairStep(s, { eventId: "e1" }, T0, 4);
		expect(scanned).toMatchObject({ calls: 4, repaired: [], job: { fixes: [{}, {}] } });
		const written = await repairStep(s, scanned.job as NonNullable<typeof scanned.job>, T0, 8);
		expect(written).toMatchObject({ job: null, calls: 2 });
		expect(written.repaired).toHaveLength(2);

		const fresh = seededStore(5);
		const partial = await repairStep(
			fresh,
			{
				eventId: "e1",
				fixes: [
					{ collection: "ticket_types", id: "tt_a", from: { reserved: 5, sold: 0 }, to: { reserved: 0, sold: 0 } },
					{ collection: "event_configs", id: "e1", from: { reserved: 99, sold: 0 }, to: { reserved: 0, sold: 0 } },
				],
			},
			T0,
			1,
		);
		expect(partial.repaired).toHaveLength(1);
		expect(partial.job?.fixes).toHaveLength(1);
		const conflicted = await repairStep(fresh, partial.job as NonNullable<typeof partial.job>, T0, 1);
		expect(conflicted).toMatchObject({ job: null, conflicted: [{ id: "e1" }] });
		expect(await repairStep(s, { eventId: "gone" }, T0, 8)).toMatchObject({ job: null, calls: 3 });
	});
});
