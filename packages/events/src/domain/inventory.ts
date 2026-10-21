/**
 * Inventory reservation engine (EV-FR-04, EV-NFR-03, R3). The only module that writes the
 * `reserved` and `sold` counters of ticket types, occurrences and event configs.
 *
 * Every counted document keeps one `reserved` counter (held + sold seats) and a reporting `sold`
 * counter. `updateIf` guards compare stored fields with literals only and there are no
 * multi-document transactions, so a reservation is a sequence of single-document guarded
 * increments in a fixed order (ticket types by id → occurrence → event). Each guard pins the
 * capacity that was read and requires `reserved ≤ capacity - qty`; a miss means sold out, and the
 * steps already taken are decremented again (compensation). Whatever a crash leaves behind is
 * repaired by `repairEventCounters`, which recomputes the counters from live bookings.
 *
 * Ordering contract for callers (what makes drift repair safe to run at any time):
 * - write the booking (status `draft`) before calling `reserve`; mark it `held` after;
 * - call `release` before moving a booking to `expired` / `cancelled` / `refunded`.
 * Then repair can only over-count a seat briefly (safe), never under-count one (oversell).
 *
 * Bridge calls: one per step (`updateIf`), plus one per compensated step on a miss. The functions
 * here never read; callers pass the documents they already loaded.
 */
import { err, ok, type Result } from "@semics-tech/shared";

import type { BookingDoc, BookingStatus } from "../storage/schema";

export type CountedCollection = "ticket_types" | "occurrences" | "event_configs";

/** A counter delta on one counted document. */
export interface CounterRef {
	collection: CountedCollection;
	id: string;
	qty: number;
}

/** One reservation step: the capacity is the value just read, pinned by the guard. */
export interface ReserveStep extends CounterRef {
	capacity: number;
}

/** The counter fields of a counted document, as read. */
export interface Counter {
	capacity: number;
	reserved: number;
}

/** The subset of EmDash's `UpdateIfArgs` this module uses. */
export interface UpdateIfArgsLike {
	where: Record<string, unknown>;
	set?: Record<string, unknown>;
	delta?: Record<string, { inc: number } | { dec: number }>;
}

export interface CounterCollection {
	updateIf(id: string, args: UpdateIfArgsLike): Promise<{ applied: boolean }>;
}

export type CounterStorage = Record<CountedCollection, CounterCollection>;

type Page = { items: Array<{ id: string; data: unknown }>; hasMore?: boolean; cursor?: string };

/** What `repairEventCounters` reads besides the counter collections. */
export interface InventoryStorage extends CounterStorage {
	event_configs: CounterCollection & { get(id: string): Promise<unknown> };
	ticket_types: CounterCollection & { query(options: unknown): Promise<Page> };
	occurrences: CounterCollection & { query(options: unknown): Promise<Page> };
	bookings: { query(options: unknown): Promise<Page> };
}

/**
 * Fields an admin edit never diffs: the counters (only this module writes them), `orphaned` (the
 * delete hooks) and the config's derived `catalog` (written separately by `config/save`).
 */
const MANAGED_FIELDS = new Set(["reserved", "sold", "orphaned", "catalog"]);

/** Designs target ≤ 8 bridge calls per invocation (R22). */
export const DEFAULT_MAX_CALLS = 8;

const isQty = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const strip = ({ collection, id, qty }: CounterRef): CounterRef => ({ collection, id, qty });
const keyOf = (collection: CountedCollection, id: string) => `${collection}/${id}`;

// --- reserving -------------------------------------------------------------------------------------

export interface ReservationRequest {
	eventId: string;
	event: Counter;
	/** Set for an event with occurrences; `occurrence` is then the document read for it. */
	occurrenceId?: string;
	occurrence?: Counter;
	/** The ticket type documents read for the lines, by id. */
	ticketTypes: ReadonlyMap<string, Counter>;
	/** Untrusted order lines. */
	lines: ReadonlyArray<{ ticketTypeId: unknown; qty: unknown }>;
}

export type SoldOut = { code: "SOLD_OUT"; collection: CountedCollection; id: string };

export type PlanError =
	| {
			code: "BAD_REQUEST";
			reason: "NO_LINES" | "INVALID_QUANTITY" | "UNKNOWN_TICKET_TYPE" | "UNKNOWN_OCCURRENCE" | "TOO_MANY_LINES";
	  }
	| SoldOut;

/** Bridge calls a reservation of `steps` steps can make: every step, plus compensating all but one. */
export function worstCaseCalls(steps: number): number {
	return steps === 0 ? 0 : 2 * steps - 1;
}

/**
 * How a miss is undone: `full` compensates every step taken (the worst case is
 * `worstCaseCalls(steps)`); `bounded` compensates only while `reserve`'s `maxCalls` lasts and
 * leaves the rest to the sweeper's drift repair (an over-count is the safe direction), so only the
 * forward steps must fit.
 */
export type Compensation = "full" | "bounded";

/**
 * Turn an order into reservation steps in the fixed order, merging repeated ticket types. Pure.
 * Answers `SOLD_OUT` from the documents read when a step cannot fit, so a sold-out request costs
 * no writes. `maxCalls` bounds the worst case (`worstCaseCalls`, or the step count with `bounded`
 * compensation) so the caller's budget holds.
 */
export function planReservation(
	req: ReservationRequest,
	{ maxCalls = DEFAULT_MAX_CALLS, compensation = "full" }: { maxCalls?: number; compensation?: Compensation } = {},
): Result<ReserveStep[], PlanError> {
	const bad = (reason: Extract<PlanError, { code: "BAD_REQUEST" }>["reason"]) =>
		err({ code: "BAD_REQUEST" as const, reason });
	if (!Array.isArray(req.lines) || req.lines.length === 0) return bad("NO_LINES");
	const perType = new Map<string, number>();
	for (const line of req.lines) {
		if (!isQty(line.qty)) return bad("INVALID_QUANTITY");
		if (typeof line.ticketTypeId !== "string" || !req.ticketTypes.has(line.ticketTypeId)) {
			return bad("UNKNOWN_TICKET_TYPE");
		}
		perType.set(line.ticketTypeId, (perType.get(line.ticketTypeId) ?? 0) + line.qty);
	}
	if (req.occurrenceId !== undefined && !req.occurrence) return bad("UNKNOWN_OCCURRENCE");

	const total = [...perType.values()].reduce((a, b) => a + b, 0);
	const read: Array<[ReserveStep, Counter]> = [...perType.keys()].sort().map((id) => {
		const doc = req.ticketTypes.get(id) as Counter;
		return [{ collection: "ticket_types", id, qty: perType.get(id) as number, capacity: doc.capacity }, doc];
	});
	if (req.occurrenceId !== undefined && req.occurrence) {
		read.push([
			{ collection: "occurrences", id: req.occurrenceId, qty: total, capacity: req.occurrence.capacity },
			req.occurrence,
		]);
	}
	read.push([{ collection: "event_configs", id: req.eventId, qty: total, capacity: req.event.capacity }, req.event]);

	const worst = compensation === "full" ? worstCaseCalls(read.length) : read.length;
	if (worst > maxCalls) return bad("TOO_MANY_LINES");
	for (const [step, doc] of read) {
		if ((doc.reserved ?? 0) + step.qty > step.capacity) {
			return err({ code: "SOLD_OUT", collection: step.collection, id: step.id });
		}
	}
	return ok(read.map(([step]) => step));
}

export type ReserveError = (SoldOut | { code: "INTERNAL"; cause: unknown }) & {
	/** Steps taken that could not be undone; drift repair fixes them. */
	uncompensated: CounterRef[];
};

/**
 * Apply the steps in order. On a guard miss (`SOLD_OUT`) or a storage error (`INTERNAL`) the steps
 * already applied are decremented again before returning, as many as `maxCalls` (forward steps
 * plus compensations) allows, earliest first; the rest come back as `uncompensated` for drift
 * repair. A step whose `updateIf` threw is not compensated: if it did commit, the over-count is
 * safe and repair removes it.
 */
export async function reserve(
	storage: CounterStorage,
	steps: ReserveStep[],
	{ maxCalls = Number.POSITIVE_INFINITY }: { maxCalls?: number } = {},
): Promise<Result<ReserveStep[], ReserveError>> {
	const done: ReserveStep[] = [];
	const undo = async () => {
		const room = Math.max(0, maxCalls - (done.length + 1));
		const failed = await release(storage, done.slice(0, room));
		return [...failed, ...done.slice(room).map(strip)];
	};
	for (const step of steps) {
		let applied: boolean;
		try {
			({ applied } = await storage[step.collection].updateIf(step.id, {
				where: { capacity: step.capacity, reserved: { lte: step.capacity - step.qty } },
				delta: { reserved: { inc: step.qty } },
			}));
		} catch (cause) {
			return err({ code: "INTERNAL", cause, uncompensated: await undo() });
		}
		if (!applied) {
			return err({ code: "SOLD_OUT", collection: step.collection, id: step.id, uncompensated: await undo() });
		}
		done.push(step);
	}
	return ok(done);
}

/** Run one guarded write per ref in parallel; return the refs whose write missed or threw. */
async function eachRef(refs: CounterRef[], write: (ref: CounterRef) => Promise<{ applied: boolean }>) {
	const results = await Promise.all(
		refs.map((ref) =>
			write(ref).then(
				(r) => r.applied,
				() => false,
			),
		),
	);
	return refs.filter((_, i) => !results[i]).map(strip);
}

/**
 * Give seats back (hold expired, booking cancelled or refunded, or compensation). With
 * `sold: true` the booking was confirmed, so `sold` drops too. Never drives a counter negative.
 * Returns the refs it could not release.
 */
export function release(storage: CounterStorage, refs: CounterRef[], { sold = false } = {}): Promise<CounterRef[]> {
	return eachRef(refs, (ref) =>
		storage[ref.collection].updateIf(ref.id, {
			where: { reserved: { gte: ref.qty }, ...(sold ? { sold: { gte: ref.qty } } : {}) },
			delta: { reserved: { dec: ref.qty }, ...(sold ? { sold: { dec: ref.qty } } : {}) },
		}),
	);
}

/**
 * Take back seats that `release` gave up for a booking that turned out to still be live (its move to
 * `expired` lost a race with another writer). Unguarded on capacity: the seats belong to a live
 * booking, and an over-count is the safe direction (it blocks sales; drift repair removes it).
 * Returns the refs it could not restore.
 */
export function restore(storage: CounterStorage, refs: CounterRef[]): Promise<CounterRef[]> {
	return eachRef(refs, (ref) =>
		storage[ref.collection].updateIf(ref.id, {
			where: { reserved: { gte: 0 } },
			delta: { reserved: { inc: ref.qty } },
		}),
	);
}

/** Sum refs that name the same counted document (one guarded write each, R22). Pure. */
export function mergeRefs(refs: Iterable<CounterRef>): CounterRef[] {
	const merged = new Map<string, CounterRef>();
	for (const ref of refs) {
		const key = keyOf(ref.collection, ref.id);
		const m = merged.get(key);
		if (m) m.qty += ref.qty;
		else merged.set(key, strip(ref));
	}
	return [...merged.values()];
}

/** Count a booking's reserved seats as sold (on confirm). Returns the refs it could not count. */
export function confirmSold(storage: CounterStorage, refs: CounterRef[]): Promise<CounterRef[]> {
	return eachRef(refs, (ref) =>
		storage[ref.collection].updateIf(ref.id, {
			where: { reserved: { gte: ref.qty } },
			delta: { sold: { inc: ref.qty } },
		}),
	);
}

/** The counters a booking holds, in reservation order. */
export function countersForBooking(booking: Pick<BookingDoc, "eventId" | "occurrenceId" | "lines">): CounterRef[] {
	const perType = new Map<string, number>();
	for (const line of booking.lines) perType.set(line.ticketTypeId, (perType.get(line.ticketTypeId) ?? 0) + line.qty);
	const total = [...perType.values()].reduce((a, b) => a + b, 0);
	const refs: CounterRef[] = [...perType.keys()]
		.sort()
		.map((id) => ({ collection: "ticket_types", id, qty: perType.get(id) as number }));
	if (booking.occurrenceId) refs.push({ collection: "occurrences", id: booking.occurrenceId, qty: total });
	refs.push({ collection: "event_configs", id: booking.eventId, qty: total });
	return refs;
}

// --- drift repair ----------------------------------------------------------------------------------

/** Bookings whose seats count as reserved. `draft` counts only while it may be mid-reservation. */
export const LIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
	"held",
	"awaiting_signature",
	"awaiting_payment",
	"confirmed",
];

/** How long a `draft` booking counts as live: longer than any reserve route can run. */
export const DRAFT_GRACE_MS = 5 * 60_000;

export type BookingLike = Pick<BookingDoc, "eventId" | "occurrenceId" | "lines" | "status" | "createdAt">;
export type Tally = Map<string, { reserved: number; sold: number }>;

/** What the counters should be, from bookings: `reserved` from live ones, `sold` from confirmed. */
export function tallyBookings(bookings: Iterable<BookingLike>, now: number): Tally {
	const tally: Tally = new Map();
	for (const b of bookings) {
		const draftLive = b.status === "draft" && now - Date.parse(b.createdAt) < DRAFT_GRACE_MS;
		if (!draftLive && !LIVE_BOOKING_STATUSES.includes(b.status)) continue;
		const sold = b.status === "confirmed";
		for (const ref of countersForBooking(b)) {
			const key = keyOf(ref.collection, ref.id);
			const t = tally.get(key) ?? { reserved: 0, sold: 0 };
			t.reserved += ref.qty;
			if (sold) t.sold += ref.qty;
			tally.set(key, t);
		}
	}
	return tally;
}

export interface CounterSnapshot {
	collection: CountedCollection;
	id: string;
	reserved: number;
	sold: number;
}

export interface DriftFix {
	collection: CountedCollection;
	id: string;
	from: { reserved: number; sold: number };
	to: { reserved: number; sold: number };
}

/** Fixes for the documents whose counters differ from the tally (absent from it means zero). */
export function planDriftRepair(snapshot: CounterSnapshot[], tally: Tally): DriftFix[] {
	return snapshot.flatMap((doc) => {
		const to = tally.get(keyOf(doc.collection, doc.id)) ?? { reserved: 0, sold: 0 };
		if (to.reserved === doc.reserved && to.sold === doc.sold) return [];
		return [
			{ collection: doc.collection, id: doc.id, from: { reserved: doc.reserved, sold: doc.sold }, to: { ...to } },
		];
	});
}

/**
 * Write the fixes, each guarded on the counters still being what the snapshot read: a counter that
 * moved since (a reservation or release in flight) is left alone and reported as conflicted.
 */
export async function applyDriftRepair(
	storage: CounterStorage,
	fixes: DriftFix[],
): Promise<{ repaired: DriftFix[]; conflicted: DriftFix[] }> {
	const applied = await Promise.all(
		fixes.map((fix) =>
			storage[fix.collection]
				.updateIf(fix.id, { where: { reserved: fix.from.reserved, sold: fix.from.sold }, set: { ...fix.to } })
				.then(
					(r) => r.applied,
					() => false,
				),
		),
	);
	return { repaired: fixes.filter((_, i) => applied[i]), conflicted: fixes.filter((_, i) => !applied[i]) };
}

const snap = (collection: CountedCollection, id: string, data: unknown): CounterSnapshot => {
	const d = data as { reserved?: number; sold?: number };
	return { collection, id, reserved: d.reserved ?? 0, sold: d.sold ?? 0 };
};

/**
 * Recompute an event's counters from its live bookings, within `maxCalls` bridge calls: three
 * reads of the counted documents (strictly before the booking scan, which is what makes the
 * guarded fix safe), the booking pages, then one write per drifted document. If the bookings do
 * not fit the budget nothing is written (`complete: false`); fixes beyond it are `pending`.
 */
export async function repairEventCounters(
	storage: InventoryStorage,
	eventId: string,
	now: number,
	{ maxCalls = DEFAULT_MAX_CALLS }: { maxCalls?: number } = {},
): Promise<{ complete: boolean; repaired: DriftFix[]; conflicted: DriftFix[]; pending: DriftFix[] }> {
	const where = { eventId };
	const [config, tts, occs] = await Promise.all([
		storage.event_configs.get(eventId),
		storage.ticket_types.query({ where, limit: 100 }),
		storage.occurrences.query({ where, limit: 100 }),
	]);
	const none = { repaired: [], conflicted: [], pending: [] };
	if (!config) return { complete: true, ...none };
	let calls = 3;

	const bookings: BookingLike[] = [];
	let cursor: string | undefined;
	for (;;) {
		if (calls >= maxCalls) return { complete: false, ...none };
		const page = await storage.bookings.query({
			where: { eventId, status: { in: [...LIVE_BOOKING_STATUSES, "draft"] } },
			limit: 100,
			...(cursor ? { cursor } : {}),
		});
		calls++;
		for (const item of page.items) bookings.push(item.data as BookingLike);
		if (!page.hasMore) break;
		cursor = page.cursor;
	}

	const snapshot = [
		snap("event_configs", eventId, config),
		...tts.items.map((i) => snap("ticket_types", i.id, i.data)),
		...occs.items.map((i) => snap("occurrences", i.id, i.data)),
	];
	const fixes = planDriftRepair(snapshot, tallyBookings(bookings, now));
	const writable = fixes.slice(0, Math.max(0, maxCalls - calls));
	const pending = fixes.slice(writable.length);
	const { repaired, conflicted } = await applyDriftRepair(storage, writable);
	return { complete: pending.length === 0, repaired, conflicted, pending };
}

// --- resumable drift repair (sweep-holds, across cron ticks) --------------------------------------

/**
 * A drift repair in progress, small enough for one KV value. The same three phases as
 * `repairEventCounters`, spread over as many invocations as the event needs: snapshot the counted
 * documents, scan the live bookings page by page (default order, so the cursor is a stable
 * `(created_at, id)` keyset), then write the fixes. The writes are still guarded on the snapshot,
 * so a reservation, release or confirm landing between ticks turns its fix into a conflict instead
 * of a wrong count; the next pass retries.
 */
export interface RepairJob {
	eventId: string;
	/** Clock reading when the counters were snapshotted: the tally's `now` for every page. */
	at?: number;
	snapshot?: CounterSnapshot[];
	tally?: Array<[string, { reserved: number; sold: number }]>;
	/** Booking scan cursor, after the first page. */
	cursor?: string;
	/** Fixes left to write once the scan is complete. */
	fixes?: DriftFix[];
}

export interface RepairStepResult {
	/** What is left to do, or `null` when the event is repaired (or gone). */
	job: RepairJob | null;
	/** Bridge calls this step made. */
	calls: number;
	repaired: DriftFix[];
	conflicted: DriftFix[];
}

/** Bridge calls the snapshot phase makes (config, ticket types, occurrences). */
export const REPAIR_SNAPSHOT_CALLS = 3;

/** Advance a repair job by at most `maxCalls` bridge calls. */
export async function repairStep(
	storage: InventoryStorage,
	job: RepairJob,
	now: number,
	maxCalls: number,
): Promise<RepairStepResult> {
	let calls = 0;
	let j: RepairJob = { ...job };
	const result = (next: RepairJob | null, fixed = { repaired: [] as DriftFix[], conflicted: [] as DriftFix[] }) => ({
		job: next,
		calls,
		...fixed,
	});

	if (!j.snapshot && !j.fixes) {
		if (maxCalls < REPAIR_SNAPSHOT_CALLS) return result(j);
		const where = { eventId: j.eventId };
		const [config, tts, occs] = await Promise.all([
			storage.event_configs.get(j.eventId),
			storage.ticket_types.query({ where, limit: 100 }),
			storage.occurrences.query({ where, limit: 100 }),
		]);
		calls += REPAIR_SNAPSHOT_CALLS;
		if (!config) return result(null);
		j = {
			eventId: j.eventId,
			at: now,
			snapshot: [
				snap("event_configs", j.eventId, config),
				...tts.items.map((i) => snap("ticket_types", i.id, i.data)),
				...occs.items.map((i) => snap("occurrences", i.id, i.data)),
			],
			tally: [],
		};
	}

	while (!j.fixes) {
		if (calls >= maxCalls) return result(j);
		const page = await storage.bookings.query({
			where: { eventId: j.eventId, status: { in: [...LIVE_BOOKING_STATUSES, "draft"] } },
			limit: 100,
			...(j.cursor ? { cursor: j.cursor } : {}),
		});
		calls++;
		const tally: Tally = new Map(j.tally ?? []);
		const pageTally = tallyBookings(
			page.items.map((i) => i.data as BookingLike),
			j.at ?? now,
		);
		for (const [key, t] of pageTally) {
			const acc = tally.get(key) ?? { reserved: 0, sold: 0 };
			tally.set(key, { reserved: acc.reserved + t.reserved, sold: acc.sold + t.sold });
		}
		j =
			page.hasMore && page.cursor
				? { ...j, tally: [...tally], cursor: page.cursor }
				: { eventId: j.eventId, fixes: planDriftRepair(j.snapshot ?? [], tally) };
	}

	const writable = j.fixes.slice(0, Math.max(0, maxCalls - calls));
	const rest = j.fixes.slice(writable.length);
	const fixed = await applyDriftRepair(storage, writable);
	calls += writable.length;
	return result(rest.length > 0 ? { eventId: j.eventId, fixes: rest } : null, fixed);
}

// --- admin edits of counted documents (config/save) ------------------------------------------------

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The non-counter fields that differ between a stored counted document and its edited version, as
 * an `updateIf` `set` (a field the edit drops is set to `null`: a merge cannot remove a key), or
 * `null` when nothing changed. Pure.
 */
export function counterlessChanges(stored: object, next: object): Record<string, unknown> | null {
	const s = stored as Record<string, unknown>;
	const n = next as Record<string, unknown>;
	const set: Record<string, unknown> = {};
	for (const key of new Set([...Object.keys(s), ...Object.keys(n)])) {
		if (MANAGED_FIELDS.has(key) || same(s[key], n[key])) continue;
		set[key] = n[key] ?? null;
	}
	return Object.keys(set).length > 0 ? set : null;
}

/**
 * Write an admin edit of a counted document without touching its counters, refusing (`conflict`)
 * when what is reserved *now* exceeds the new capacity, or the document is gone (EV-FR-03).
 */
export async function updateCountedFields(
	collection: CounterCollection,
	id: string,
	stored: object,
	next: { capacity: number } | object,
): Promise<"unchanged" | "applied" | "conflict"> {
	const set = counterlessChanges(stored, next);
	if (!set) return "unchanged";
	const capacity = (next as { capacity: number }).capacity;
	const { applied } = await collection.updateIf(id, { where: { reserved: { lte: capacity } }, set });
	return applied ? "applied" : "conflict";
}

/**
 * Close a counted document to new reservations before deleting it, only if it holds no seats:
 * capacity 0 fails every reservation guard, including those pinned to the old capacity.
 */
export async function retireCounted(collection: CounterCollection, id: string): Promise<boolean> {
	const { applied } = await collection.updateIf(id, { where: { reserved: 0, sold: 0 }, set: { capacity: 0 } });
	return applied;
}
