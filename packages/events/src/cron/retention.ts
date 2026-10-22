/**
 * Retention job and deletion on request (EV-FR-20, R22).
 *
 * The recurring `retention` task runs a paged job, resuming from a cursor kept in KV, each tick at
 * most 8 bridge calls; while a pass has more to do it queues a one-shot `retention-more` for the next
 * minute's tick (like the T045 drift repair). A pass has up to three phases:
 *
 * 1. `ips`: clears `ipHash` from bookings once the reserve rate window has passed (an hour; without a
 *    Turnstile secret the hash is salted with the public plugin id, so it is reversible, T057 F6).
 * 2. `bookings` (at most once a day): erases the personal data of bookings whose event ended more than
 *    `retentionDays` ago, with their attendees. Counters, totals, lines and status survive.
 * 3. `outbox`: deletes sent or failed outbox rows older than the period (they hold the recipient).
 *
 * `eraseBookings` is the one routine behind both the job and the admin's on-request deletion. A
 * booking that is still live (held, awaiting or confirmed, for an event that has not happened) is
 * never erased. The clock is passed in.
 */
import { EXPIRABLE_STATUSES } from "../domain/holds";
import { iso } from "../domain/time";
import type { AttendeeDoc, BookingDoc, EventConfigDoc, OutboxDoc } from "../storage/schema";

export const RETENTION_TASK = "retention";
export const RETENTION_MORE_TASK = "retention-more";
export const RETENTION_SCHEDULE = "17 * * * *";
export const RETENTION_STATE_KEY = "cron:retention";
const DAY = 86_400_000;
/** `ipHash` outlives the reserve rate window (10 minutes) by this much. */
const IP_WINDOW = 3_600_000;
/** Bookings whose `ipHash` is cleared per tick (one `updateIf` each). */
const IP_PAGE = 4;
const BOOKINGS_PAGE = 10;
const ATTENDEES_PAGE = 100;
const OUTBOX_PAGE = 50;
/** A full pass (phases 2 and 3) is started at most this often. */
const FULL_EVERY = 20 * 3_600_000;
const LIVE_STATUSES: readonly string[] = [...EXPIRABLE_STATUSES, "confirmed"];

type Page = { items: Array<{ id: string; data: unknown }>; hasMore?: boolean; cursor?: string };
type Query = (o: {
	where?: Record<string, unknown>;
	orderBy?: Record<string, "asc" | "desc">;
	limit?: number;
	cursor?: string;
}) => Promise<Page>;
type Put = (items: Array<{ id: string; data: unknown }>) => Promise<unknown>;

export interface RetentionStorage {
	bookings: {
		query: Query;
		putMany: Put;
		updateIf(id: string, o: { where: Record<string, unknown>; set: Record<string, unknown> }): Promise<unknown>;
	};
	event_configs: { getMany(ids: string[]): Promise<Map<string, unknown>> };
	attendees: { query: Query; putMany: Put };
	outbox: { query: Query; deleteMany(ids: string[]): Promise<unknown> };
}

export interface RetentionKv {
	getVersioned<T>(key: string): Promise<{ value: T; revision: string } | null>;
	compareAndSet(key: string, expectedRevision: string | null, value: unknown): Promise<{ applied: boolean }>;
}

export interface RetentionDeps {
	storage: RetentionStorage;
	kv: RetentionKv;
	cron?: { schedule(name: string, opts: { schedule: string }): Promise<void> } | undefined;
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	now: number;
}

/** Days to keep booking data after the event (setting `retentionDays`: default 365, minimum 30). */
export function retentionDays(raw: { retentionDays?: unknown }): number {
	const v = raw.retentionDays;
	return typeof v === "number" && Number.isFinite(v) ? Math.max(30, Math.round(v)) : 365;
}

/** When the booked event ends (or starts), in ms, from its config; `null` when the config does not say. */
function eventTime(b: BookingDoc, c: EventConfigDoc | undefined): number | null {
	const occ = b.occurrenceId === undefined ? undefined : c?.catalog?.occurrences?.[b.occurrenceId]?.startsAt;
	const ms = Date.parse(occ ?? c?.info?.endsAt ?? c?.info?.startsAt ?? c?.salesEnd ?? "");
	return Number.isFinite(ms) ? ms : null;
}

export interface EraseOptions {
	/** The job's cutoff (ms): only bookings whose event ended before it. Omitted: erase on request. */
	cutoff?: number;
	/** Resume the attendee scan here (the job). */
	acursor?: string;
	/** Attendee pages to read in this call. */
	pages?: number;
}

export interface EraseResult {
	erased: number;
	kept: number;
	/** False when attendees remain: nothing is marked erased yet; resume from `cursor`. */
	complete: boolean;
	cursor?: string | undefined;
	/** `createdAt` of the first booking that was neither erased now nor before (the job's floor). */
	held?: string | undefined;
	calls: number;
}

/**
 * Erase the personal data of these bookings and their attendees, then (on request) the sent
 * outbox rows addressed to their buyers. Calls: configs, ≤ `pages` × (attendees read + write),
 * bookings write, and on request an outbox read and delete.
 */
export async function eraseBookings(
	st: RetentionStorage,
	items: Page["items"],
	now: number,
	{ cutoff, acursor, pages = 1 }: EraseOptions = {},
): Promise<EraseResult> {
	const configs = await st.event_configs.getMany([...new Set(items.map((i) => (i.data as BookingDoc).eventId))]);
	let calls = 1;
	let held: string | undefined;
	let pending = 0;
	const todo = items.filter(({ data }) => {
		const b = data as BookingDoc;
		if (b.erasedAt) return false;
		pending++;
		const t = eventTime(b, configs.get(b.eventId) as EventConfigDoc | undefined);
		const live = LIVE_STATUSES.includes(b.status) && (t === null || t >= now);
		if (!live && (cutoff === undefined || (t ?? Date.parse(b.createdAt)) < cutoff)) return true;
		held ??= b.createdAt;
		return false;
	});
	const result = { erased: 0, kept: pending - todo.length, complete: true, held, calls };
	if (todo.length === 0) return result;

	let cursor = acursor;
	for (let left = pages; ; ) {
		const page = await st.attendees.query({
			where: { bookingId: { in: todo.map((t) => t.id) } },
			limit: ATTENDEES_PAGE,
			...(cursor ? { cursor } : {}),
		});
		calls++;
		if (page.items.length > 0) {
			await st.attendees.putMany(
				page.items.map((a) => ({ id: a.id, data: { ...(a.data as AttendeeDoc), name: "", email: "" } })),
			);
			calls++;
		}
		cursor = page.hasMore ? page.cursor : undefined;
		if (!cursor || --left <= 0) break;
	}
	if (cursor) return { ...result, complete: false, cursor, calls };

	const emails = todo.map((t) => (t.data as BookingDoc).buyer?.email).filter(Boolean);
	await st.bookings.putMany(
		todo.map(({ id, data }) => ({
			id,
			data: {
				...(data as BookingDoc),
				buyer: { name: "", email: "" },
				email: "",
				answers: {},
				ipHash: null,
				redeemHash: null,
				redeemExpiresAt: null,
				accessTokenHash: "",
				erasedAt: iso(now),
			},
		})),
	);
	calls++;
	if (cutoff === undefined && emails.length > 0) {
		const rows = await st.outbox.query({ where: { to: { in: emails } }, limit: OUTBOX_PAGE });
		calls++;
		const ids = rows.items.filter((r) => (r.data as OutboxDoc).status !== "pending").map((r) => r.id);
		if (ids.length > 0) {
			await st.outbox.deleteMany(ids);
			calls++;
		}
	}
	return { ...result, erased: todo.length, calls };
}

/** What the job keeps between ticks. */
export interface RetentionState {
	phase?: "ips" | "bookings" | "outbox";
	days?: number;
	/** The page cursor of the phase in progress, and the attendee cursor of the current page. */
	cursor?: string;
	acursor?: string;
	/** Bookings created before this are all erased: the next pass starts here. */
	floor?: string;
	/** The first booking this pass left (not yet due or live); becomes the floor. */
	keep?: string;
	/** Bookings created before this have had their `ipHash` cleared. */
	ipFrom?: string;
	fullAt?: string;
}

export interface RetentionReport {
	calls: number;
	phase: RetentionState["phase"];
	erased: number;
	/** The pass is finished: no follow-up is queued. */
	idle: boolean;
}

/** One `retention` tick. */
export async function retentionTick({ storage, kv, cron, settings, now }: RetentionDeps): Promise<RetentionReport> {
	const stored = await kv.getVersioned<RetentionState>(RETENTION_STATE_KEY);
	let calls = 1;
	const before = JSON.stringify(stored?.value ?? {});
	const s: RetentionState = structuredClone(stored?.value ?? {});
	const phase = s.phase;
	let erased = 0;
	let idle = false;
	const cutoff = now - (s.days ?? 365) * DAY;

	if (!phase) {
		const entries = await settings.list();
		calls++;
		s.days = retentionDays(Object.fromEntries(entries.map((e) => [e.key, e.value])));
		s.phase = "ips";
	} else if (phase === "ips") {
		const page = await storage.bookings.query({
			where: { createdAt: { gte: s.ipFrom ?? "0", lt: iso(now - IP_WINDOW) } },
			orderBy: { createdAt: "asc" },
			limit: IP_PAGE,
			...(s.cursor ? { cursor: s.cursor } : {}),
		});
		calls++;
		for (const { id, data } of page.items) {
			const b = data as BookingDoc;
			if (!b.ipHash) continue;
			await storage.bookings.updateIf(id, { where: { createdAt: b.createdAt }, set: { ipHash: null } });
			calls++;
		}
		if (page.hasMore && page.cursor) s.cursor = page.cursor;
		else {
			delete s.cursor;
			s.ipFrom = (page.items.at(-1)?.data as BookingDoc | undefined)?.createdAt ?? s.ipFrom;
			if (!s.fullAt || now - Date.parse(s.fullAt) >= FULL_EVERY) {
				s.phase = "bookings";
				s.fullAt = iso(now);
			} else idle = true;
		}
	} else if (phase === "bookings") {
		const page = await storage.bookings.query({
			where: { createdAt: { gte: s.floor ?? "0", lt: iso(cutoff) } },
			orderBy: { createdAt: "asc" },
			limit: BOOKINGS_PAGE,
			...(s.cursor ? { cursor: s.cursor } : {}),
		});
		calls++;
		const out = await eraseBookings(storage, page.items, now, { cutoff, ...(s.acursor ? { acursor: s.acursor } : {}) });
		calls += out.calls;
		erased = out.erased;
		if (!out.complete) s.acursor = out.cursor as string;
		else {
			delete s.acursor;
			s.keep ??= out.held;
			if (page.hasMore && page.cursor) s.cursor = page.cursor;
			else {
				s.floor = s.keep ?? (page.items.at(-1)?.data as BookingDoc | undefined)?.createdAt ?? s.floor;
				delete s.cursor;
				delete s.keep;
				s.phase = "outbox";
			}
		}
	} else {
		const page = await storage.outbox.query({
			where: { status: { in: ["sent", "failed"] }, nextAttemptAt: { lt: iso(cutoff) } },
			limit: OUTBOX_PAGE,
		});
		calls++;
		if (page.items.length > 0) {
			await storage.outbox.deleteMany(page.items.map((i) => i.id));
			calls++;
		}
		if (!page.hasMore) idle = true;
	}

	if (idle) delete s.phase;
	if (JSON.stringify(s) !== before) {
		await kv.compareAndSet(RETENTION_STATE_KEY, stored?.revision ?? null, s).catch(() => undefined);
		calls++;
	}
	if (!idle && cron) {
		await cron.schedule(RETENTION_MORE_TASK, { schedule: iso(now) });
		calls++;
	}
	return { calls, phase, erased, idle };
}

/** The `cron` hook: `retention` and its follow-up one-shot. Returns whether the event was ours. */
export async function runRetentionJob(
	event: { name: string },
	ctx: {
		storage: unknown;
		kv: RetentionKv;
		cron?: RetentionDeps["cron"];
		settings: RetentionDeps["settings"];
	},
	now: number = Date.now(),
): Promise<boolean> {
	if (event.name !== RETENTION_TASK && event.name !== RETENTION_MORE_TASK) return false;
	await retentionTick({
		storage: ctx.storage as RetentionStorage,
		kv: ctx.kv,
		cron: ctx.cron,
		settings: ctx.settings,
		now,
	});
	return true;
}
