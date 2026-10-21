import { describe, expect, it } from "vitest";

import {
	applyDriftRepair,
	type CounterCollection,
	type CounterStorage,
	confirmSold,
	countersForBooking,
	DRAFT_GRACE_MS,
	planDriftRepair,
	planReservation,
	type ReservationRequest,
	release,
	repairEventCounters,
	reserve,
	retireCounted,
	tallyBookings,
	updateCountedFields,
	worstCaseCalls,
} from "../../src/domain/inventory";

// --- an in-memory store with the same updateIf semantics as EmDash's guarded UPDATE ---------------

type Doc = Record<string, unknown>;
type Range = { lt?: number; lte?: number; gt?: number; gte?: number };

function matches(doc: Doc, where: Record<string, unknown>): boolean {
	return Object.entries(where).every(([field, cond]) => {
		const value = doc[field];
		if (cond !== null && typeof cond === "object") {
			if ("in" in cond) return (cond as { in: unknown[] }).in.includes(value);
			const r = cond as Range;
			if (typeof value !== "number") return false;
			return (
				(r.lt === undefined || value < r.lt) &&
				(r.lte === undefined || value <= r.lte) &&
				(r.gt === undefined || value > r.gt) &&
				(r.gte === undefined || value >= r.gte)
			);
		}
		return value === cond;
	});
}

class FakeCollection implements CounterCollection {
	readonly docs = new Map<string, Doc>();
	calls = 0;
	failOn: ((id: string, args: unknown) => boolean) | null = null;

	async updateIf(
		id: string,
		args: {
			where: Record<string, unknown>;
			set?: Record<string, unknown>;
			delta?: Record<string, { inc: number } | { dec: number }>;
		},
	) {
		this.calls++;
		if (this.failOn?.(id, args)) throw new Error("injected storage failure");
		const doc = this.docs.get(id);
		if (!doc || !matches(doc, args.where)) return { applied: false as const };
		const next: Doc = { ...doc, ...(args.set ?? {}) };
		for (const [field, d] of Object.entries(args.delta ?? {})) {
			const base = typeof doc[field] === "number" ? (doc[field] as number) : 0;
			next[field] = "inc" in d ? base + d.inc : base - d.dec;
		}
		this.docs.set(id, next);
		return { applied: true as const, data: next };
	}
}

function makeStorage() {
	const s = {
		ticket_types: new FakeCollection(),
		occurrences: new FakeCollection(),
		event_configs: new FakeCollection(),
	};
	return s satisfies CounterStorage;
}

const counter = (capacity: number, reserved = 0, sold = 0) => ({ capacity, reserved, sold });

function seeded() {
	const s = makeStorage();
	s.ticket_types.docs.set("tt_a", { eventId: "e1", ...counter(10) });
	s.ticket_types.docs.set("tt_b", { eventId: "e1", ...counter(5) });
	s.occurrences.docs.set("occ_1", { eventId: "e1", ...counter(12) });
	s.event_configs.docs.set("e1", { status: "on_sale", ...counter(20) });
	return s;
}

const reserved = (s: ReturnType<typeof makeStorage>) => ({
	tt_a: s.ticket_types.docs.get("tt_a")?.reserved,
	tt_b: s.ticket_types.docs.get("tt_b")?.reserved,
	occ_1: s.occurrences.docs.get("occ_1")?.reserved,
	e1: s.event_configs.docs.get("e1")?.reserved,
});

function request(
	s: ReturnType<typeof makeStorage>,
	lines: ReservationRequest["lines"],
	withOccurrence = true,
): ReservationRequest {
	const read = (c: FakeCollection, id: string) => c.docs.get(id) as { capacity: number; reserved: number };
	return {
		eventId: "e1",
		event: read(s.event_configs, "e1"),
		...(withOccurrence ? { occurrenceId: "occ_1", occurrence: read(s.occurrences, "occ_1") } : {}),
		ticketTypes: new Map([
			["tt_a", read(s.ticket_types, "tt_a")],
			["tt_b", read(s.ticket_types, "tt_b")],
		]),
		lines,
	};
}

function plan(s: ReturnType<typeof makeStorage>, lines: ReservationRequest["lines"], withOccurrence = true) {
	const r = planReservation(request(s, lines, withOccurrence));
	if (!r.ok) throw new Error(`plan failed: ${JSON.stringify(r.error)}`);
	return r.value;
}

// --- planning --------------------------------------------------------------------------------------

describe("planReservation (EV-FR-04, R3)", () => {
	it("EV-FR-04 orders steps ticket types (by id) → occurrence → event and merges duplicate lines", () => {
		const s = seeded();
		const steps = plan(s, [
			{ ticketTypeId: "tt_b", qty: 1 },
			{ ticketTypeId: "tt_a", qty: 2 },
			{ ticketTypeId: "tt_b", qty: 1 },
		]);
		expect(steps.map((x) => [x.collection, x.id, x.qty, x.capacity])).toEqual([
			["ticket_types", "tt_a", 2, 10],
			["ticket_types", "tt_b", 2, 5],
			["occurrences", "occ_1", 4, 12],
			["event_configs", "e1", 4, 20],
		]);
	});

	it("EV-FR-04 rejects bad lines with a reason", () => {
		const s = seeded();
		const reason = (lines: ReservationRequest["lines"], extra: Partial<ReservationRequest> = {}) => {
			const r = planReservation({ ...request(s, lines), ...extra });
			return r.ok ? "ok" : r.error.code === "BAD_REQUEST" ? r.error.reason : r.error.code;
		};
		expect(reason([])).toBe("NO_LINES");
		expect(reason([{ ticketTypeId: "tt_a", qty: 0 }])).toBe("INVALID_QUANTITY");
		expect(reason([{ ticketTypeId: "tt_a", qty: 1.5 }])).toBe("INVALID_QUANTITY");
		expect(reason([{ ticketTypeId: "tt_a", qty: "2" }])).toBe("INVALID_QUANTITY");
		expect(reason([{ ticketTypeId: "nope", qty: 1 }])).toBe("UNKNOWN_TICKET_TYPE");
		expect(reason([{ ticketTypeId: 7, qty: 1 }])).toBe("UNKNOWN_TICKET_TYPE");
		expect(reason([{ ticketTypeId: "tt_a", qty: 1 }], { occurrence: undefined })).toBe("UNKNOWN_OCCURRENCE");
		expect(reason([{ ticketTypeId: "tt_a", qty: 1 }])).toBe("ok");
	});

	it("EV-NFR-03 refuses a plan whose worst case would exceed the call budget", () => {
		const s = seeded();
		const lines = [
			{ ticketTypeId: "tt_a", qty: 1 },
			{ ticketTypeId: "tt_b", qty: 1 },
		];
		// 4 steps: 4 forward calls + 3 compensations.
		expect(worstCaseCalls(4)).toBe(7);
		expect(planReservation(request(s, lines), { maxCalls: 7 }).ok).toBe(true);
		const r = planReservation(request(s, lines), { maxCalls: 6 });
		expect(r).toMatchObject({ ok: false, error: { code: "BAD_REQUEST", reason: "TOO_MANY_LINES" } });
	});

	it("EV-FR-04 answers SOLD_OUT from the documents just read, before any write", () => {
		const s = seeded();
		s.ticket_types.docs.set("tt_b", { eventId: "e1", ...counter(5, 4) });
		const r = planReservation(request(s, [{ ticketTypeId: "tt_b", qty: 2 }]));
		expect(r).toMatchObject({ ok: false, error: { code: "SOLD_OUT", collection: "ticket_types", id: "tt_b" } });
		s.event_configs.docs.set("e1", { ...counter(20, 19) });
		const e = planReservation(request(s, [{ ticketTypeId: "tt_a", qty: 2 }], false));
		expect(e).toMatchObject({ ok: false, error: { code: "SOLD_OUT", collection: "event_configs", id: "e1" } });
	});
});

// --- reserving -------------------------------------------------------------------------------------

describe("reserve (EV-FR-04, R3)", () => {
	it("EV-FR-04 increments every counter once", async () => {
		const s = seeded();
		const r = await reserve(s, plan(s, [{ ticketTypeId: "tt_a", qty: 3 }]));
		expect(r.ok).toBe(true);
		expect(reserved(s)).toEqual({ tt_a: 3, tt_b: 0, occ_1: 3, e1: 3 });
	});

	it("EV-FR-04 a miss at a later step compensates the earlier ones and returns SOLD_OUT", async () => {
		const s = seeded();
		const steps = plan(s, [{ ticketTypeId: "tt_a", qty: 3 }]);
		// Someone else fills the occurrence after we read it.
		s.occurrences.docs.set("occ_1", { eventId: "e1", ...counter(12, 11) });
		const r = await reserve(s, steps);
		expect(r).toMatchObject({ ok: false, error: { code: "SOLD_OUT", collection: "occurrences", id: "occ_1" } });
		expect(r.ok || r.error.uncompensated).toEqual([]);
		expect(reserved(s)).toEqual({ tt_a: 0, tt_b: 0, occ_1: 11, e1: 0 });
	});

	it("R3 the guard pins the capacity that was read, so a concurrent capacity cut cannot oversell", async () => {
		const s = seeded();
		const steps = plan(s, [{ ticketTypeId: "tt_a", qty: 5 }], false);
		s.ticket_types.docs.set("tt_a", { eventId: "e1", ...counter(4) });
		const r = await reserve(s, steps);
		expect(r).toMatchObject({ ok: false, error: { code: "SOLD_OUT", id: "tt_a" } });
		expect(reserved(s).tt_a).toBe(0);
	});

	it("R3 injected failure between steps leaves counters unchanged after compensation", async () => {
		for (const failing of ["tt_b", "occ_1", "e1"]) {
			const s = seeded();
			const before = reserved(s);
			const steps = plan(s, [
				{ ticketTypeId: "tt_a", qty: 1 },
				{ ticketTypeId: "tt_b", qty: 1 },
			]);
			const fail = (id: string, args: unknown) =>
				id === failing && "inc" in (args as { delta: { reserved: object } }).delta.reserved;
			s.ticket_types.failOn = fail;
			s.occurrences.failOn = fail;
			s.event_configs.failOn = fail;
			const r = await reserve(s, steps);
			expect(r).toMatchObject({ ok: false, error: { code: "INTERNAL", uncompensated: [] } });
			expect(reserved(s)).toEqual(before);
		}
	});

	it("R3 reports the steps it could not compensate, for the sweeper to repair", async () => {
		const s = seeded();
		const steps = plan(s, [{ ticketTypeId: "tt_a", qty: 2 }]);
		s.event_configs.docs.set("e1", { ...counter(20, 19) });
		s.ticket_types.failOn = (_id, args) => "dec" in (args as { delta: { reserved: object } }).delta.reserved;
		const r = await reserve(s, steps);
		expect(r).toMatchObject({
			ok: false,
			error: { code: "SOLD_OUT", id: "e1", uncompensated: [{ collection: "ticket_types", id: "tt_a", qty: 2 }] },
		});
		expect(reserved(s)).toEqual({ tt_a: 2, tt_b: 0, occ_1: 0, e1: 19 });
	});
});

describe("release and confirm (EV-FR-04)", () => {
	const booking = {
		eventId: "e1",
		occurrenceId: "occ_1",
		lines: [
			{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 100 },
			{ ticketTypeId: "tt_a", qty: 1, unitPriceMinor: 100 },
		],
	};

	it("EV-FR-04 countersForBooking names every counted document of a booking", () => {
		expect(countersForBooking(booking)).toEqual([
			{ collection: "ticket_types", id: "tt_a", qty: 3 },
			{ collection: "occurrences", id: "occ_1", qty: 3 },
			{ collection: "event_configs", id: "e1", qty: 3 },
		]);
		expect(countersForBooking({ ...booking, occurrenceId: undefined }).map((r) => r.collection)).toEqual([
			"ticket_types",
			"event_configs",
		]);
	});

	it("EV-FR-04 confirm counts sold; release gives seats back (and sold, for a confirmed booking)", async () => {
		const s = seeded();
		await reserve(s, plan(s, [{ ticketTypeId: "tt_a", qty: 3 }]));
		const refs = countersForBooking(booking);
		expect(await confirmSold(s, refs)).toEqual([]);
		expect(s.event_configs.docs.get("e1")).toMatchObject({ reserved: 3, sold: 3 });
		expect(await release(s, refs, { sold: true })).toEqual([]);
		expect(reserved(s)).toEqual({ tt_a: 0, tt_b: 0, occ_1: 0, e1: 0 });
		expect(s.event_configs.docs.get("e1")).toMatchObject({ sold: 0 });
	});

	it("EV-FR-04 release never drives a counter negative and returns what it could not release", async () => {
		const s = seeded();
		const refs = countersForBooking(booking);
		const left = await release(s, refs);
		expect(left).toEqual(refs);
		expect(reserved(s)).toEqual({ tt_a: 0, tt_b: 0, occ_1: 0, e1: 0 });
		s.occurrences.failOn = () => true;
		s.ticket_types.failOn = () => true;
		s.event_configs.failOn = () => true;
		expect(await confirmSold(s, refs)).toEqual(refs);
	});
});

// --- drift repair ----------------------------------------------------------------------------------

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function bk(status: string, lines: Array<[string, number]>, extra: Record<string, unknown> = {}) {
	return {
		eventId: "e1",
		occurrenceId: "occ_1",
		status,
		createdAt: ago(60 * 60_000),
		lines: lines.map(([ticketTypeId, qty]) => ({ ticketTypeId, qty, unitPriceMinor: 0 })),
		...extra,
	} as Parameters<typeof tallyBookings>[0] extends Iterable<infer B> ? B : never;
}

describe("drift repair (R3, EV-NFR-03)", () => {
	it("R3 tallies reserved from live bookings and sold from confirmed ones", () => {
		const tally = tallyBookings(
			[
				bk("held", [["tt_a", 2]]),
				bk("awaiting_signature", [["tt_b", 1]]),
				bk("awaiting_payment", [["tt_a", 1]]),
				bk("confirmed", [
					["tt_a", 1],
					["tt_b", 2],
				]),
				bk("expired", [["tt_a", 5]]),
				bk("cancelled", [["tt_a", 5]]),
				bk("refunded", [["tt_a", 5]]),
				bk("draft", [["tt_a", 4]], { createdAt: ago(DRAFT_GRACE_MS - 1000) }),
				bk("draft", [["tt_a", 9]], { createdAt: ago(DRAFT_GRACE_MS + 1000) }),
				bk("held", [["tt_b", 1]], { occurrenceId: undefined }),
			],
			NOW,
		);
		expect(Object.fromEntries(tally)).toEqual({
			"ticket_types/tt_a": { reserved: 8, sold: 1 },
			"ticket_types/tt_b": { reserved: 4, sold: 2 },
			"occurrences/occ_1": { reserved: 11, sold: 3 },
			"event_configs/e1": { reserved: 12, sold: 3 },
		});
	});

	it("R3 plans a fix only where a counter differs, treating untallied documents as zero", () => {
		const fixes = planDriftRepair(
			[
				{ collection: "ticket_types", id: "tt_a", reserved: 8, sold: 1 },
				{ collection: "ticket_types", id: "tt_b", reserved: 7, sold: 2 },
				{ collection: "occurrences", id: "occ_2", reserved: 3, sold: 0 },
			],
			new Map([
				["ticket_types/tt_a", { reserved: 8, sold: 1 }],
				["ticket_types/tt_b", { reserved: 4, sold: 2 }],
			]),
		);
		expect(fixes).toEqual([
			{ collection: "ticket_types", id: "tt_b", from: { reserved: 7, sold: 2 }, to: { reserved: 4, sold: 2 } },
			{ collection: "occurrences", id: "occ_2", from: { reserved: 3, sold: 0 }, to: { reserved: 0, sold: 0 } },
		]);
	});

	it("R3 a fix is skipped when the counter moved since it was read (no lost reservation)", async () => {
		const s = seeded();
		s.ticket_types.docs.set("tt_a", { eventId: "e1", ...counter(10, 6) });
		s.ticket_types.docs.set("tt_b", { eventId: "e1", ...counter(5, 3) });
		const fixes = planDriftRepair(
			[
				{ collection: "ticket_types", id: "tt_a", reserved: 5, sold: 0 },
				{ collection: "ticket_types", id: "tt_b", reserved: 3, sold: 0 },
			],
			new Map(),
		);
		const result = await applyDriftRepair(s, fixes);
		expect(result.conflicted.map((f) => f.id)).toEqual(["tt_a"]);
		expect(result.repaired.map((f) => f.id)).toEqual(["tt_b"]);
		expect(reserved(s)).toMatchObject({ tt_a: 6, tt_b: 0 });
	});

	it("R3 repairEventCounters recomputes every counter of an event from live bookings within budget", async () => {
		const s = seeded();
		s.ticket_types.docs.set("tt_a", { eventId: "e1", ...counter(10, 9) });
		s.occurrences.docs.set("occ_1", { eventId: "e1", ...counter(12, 9) });
		s.event_configs.docs.set("e1", { ...counter(20, 9) });
		const bookings = [bk("held", [["tt_a", 2]]), bk("confirmed", [["tt_b", 1]])];
		let reads = 0;
		const counted = <T>(value: T) => {
			reads++;
			return value;
		};
		const listing = (c: FakeCollection) => ({ items: [...c.docs].map(([id, data]) => ({ id, data })), hasMore: false });
		const storage = {
			...s,
			event_configs: Object.assign(s.event_configs, {
				get: async (id: string) => counted(s.event_configs.docs.get(id) ?? null),
			}),
			ticket_types: Object.assign(s.ticket_types, { query: async () => counted(listing(s.ticket_types)) }),
			occurrences: Object.assign(s.occurrences, { query: async () => counted(listing(s.occurrences)) }),
			bookings: {
				query: async (o: { where: { eventId: string; status: { in: string[] } } }) => {
					reads++;
					expect(o.where.status.in).toContain("draft");
					return { items: bookings.map((data, i) => ({ id: `b${i}`, data })), hasMore: false };
				},
			},
		};
		const r = await repairEventCounters(storage, "e1", NOW);
		expect(r).toMatchObject({ complete: true, pending: [], conflicted: [] });
		expect(reserved(s)).toEqual({ tt_a: 2, tt_b: 1, occ_1: 3, e1: 3 });
		expect(s.ticket_types.docs.get("tt_b")).toMatchObject({ sold: 1 });
		const writes = s.ticket_types.calls + s.occurrences.calls + s.event_configs.calls;
		expect(reads + writes).toBeLessThanOrEqual(8);

		// A missing config is a no-op; a booking list longer than the budget writes nothing.
		expect(await repairEventCounters(storage, "missing", NOW)).toMatchObject({ complete: true, repaired: [] });
		storage.bookings.query = async () => ({ items: [], hasMore: true, cursor: "next" }) as never;
		const partial = await repairEventCounters(storage, "e1", NOW, { maxCalls: 5 });
		expect(partial).toMatchObject({ complete: false, repaired: [] });
	});

	it("R3 repairEventCounters leaves fixes it has no budget for as pending", async () => {
		const s = seeded();
		for (const id of ["tt_a", "tt_b"]) s.ticket_types.docs.set(id, { eventId: "e1", ...counter(10, 1) });
		const storage = {
			...s,
			event_configs: Object.assign(s.event_configs, {
				get: async (id: string) => s.event_configs.docs.get(id) ?? null,
			}),
			ticket_types: Object.assign(s.ticket_types, {
				query: async () => ({ items: [...s.ticket_types.docs].map(([id, data]) => ({ id, data })), hasMore: false }),
			}),
			occurrences: Object.assign(s.occurrences, { query: async () => ({ items: [], hasMore: false }) }),
			bookings: { query: async () => ({ items: [], hasMore: false }) },
		};
		const r = await repairEventCounters(storage, "e1", NOW, { maxCalls: 5 });
		expect(r.complete).toBe(false);
		expect(r.repaired).toHaveLength(1);
		expect(r.pending).toHaveLength(1);
	});
});

// --- config/save writes ----------------------------------------------------------------------------

describe("counted-document edits for config/save (EV-FR-03)", () => {
	const stored = { eventId: "e1", name: "A", capacity: 10, reserved: 4, sold: 1, salesEnd: "2026-12-01T00:00:00.000Z" };

	it("EV-FR-03 writes only changed non-counter fields, nulls cleared ones, and keeps live counters", async () => {
		const s = seeded();
		s.ticket_types.docs.set("tt_a", { ...stored, reserved: 6 });
		const next = { eventId: "e1", name: "B", capacity: 8, reserved: 0, sold: 0 };
		expect(await updateCountedFields(s.ticket_types, "tt_a", stored, next)).toBe("applied");
		expect(s.ticket_types.docs.get("tt_a")).toEqual({ ...next, reserved: 6, sold: 1, salesEnd: null });
		const calls = s.ticket_types.calls;
		expect(await updateCountedFields(s.ticket_types, "tt_a", { ...next, reserved: 6 }, next)).toBe("unchanged");
		expect(s.ticket_types.calls).toBe(calls);
	});

	it("EV-FR-03 refuses a capacity below what is reserved at write time", async () => {
		const s = seeded();
		s.ticket_types.docs.set("tt_a", { ...stored, reserved: 9 });
		expect(await updateCountedFields(s.ticket_types, "tt_a", stored, { ...stored, capacity: 8 })).toBe("conflict");
		expect(s.ticket_types.docs.get("tt_a")).toMatchObject({ capacity: 10, reserved: 9 });
	});

	it("EV-FR-03 retires an idle document by zeroing its capacity, and refuses one in use", async () => {
		const s = seeded();
		expect(await retireCounted(s.ticket_types, "tt_a")).toBe(true);
		expect(s.ticket_types.docs.get("tt_a")).toMatchObject({ capacity: 0 });
		s.ticket_types.docs.set("tt_b", { ...stored, reserved: 1 });
		expect(await retireCounted(s.ticket_types, "tt_b")).toBe(false);
	});
});
