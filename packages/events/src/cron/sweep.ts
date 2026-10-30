/**
 * Cron jobs for holds (EV-FR-06, R1, R22, R23).
 *
 * - `sweep-holds` (every 5 min) is the source of truth: each tick expires a batch of lapsed holds,
 *   oldest first, then spends what is left of its budget on drift repair, resuming from a cursor
 *   kept in KV. When more holds are due than one tick can take, it schedules a one-shot
 *   `sweep-holds-more` for the next minute's tick, which runs the same job.
 * - `hold-<ref>` one-shots, scheduled by checkout for a booking's `holdExpiresAt`, only accelerate:
 *   a tick claims at most 10 due tasks and fires up to ~62 s late (S3, R23), so a missing, late or
 *   dropped one-shot costs nothing but latency.
 *
 * Every invocation stays within `SWEEP_MAX_CALLS` bridge calls (target 8 of the hard 10, R22). The
 * clock is passed in.
 */
import type { PluginContext } from "emdash/plugin";

import {
	EXPIRABLE_STATUSES,
	type ExpiryOutcome,
	expireBookings,
	expiryAction,
	expiryCalls,
	HOLD_STATUSES,
	HOLD_TASK_PREFIX,
	type HoldStorage,
	holdTaskName,
	planExpiries,
} from "../domain/holds";
import { type InventoryStorage, type RepairJob, repairStep } from "../domain/inventory";
import { iso, msOf } from "../domain/time";
import type { BookingDoc } from "../storage/schema";
import { jobState, type StateKv } from "./state";

export const SWEEP_TASK = "sweep-holds";
export const SWEEP_MORE_TASK = "sweep-holds-more";
export const SWEEP_SCHEDULE = "*/5 * * * *";
export const SWEEP_STATE_KEY = "cron:sweep-holds";
/** Designs target ≤ 8 bridge calls per invocation (R22). */
export const SWEEP_MAX_CALLS = 8;
/** Lapsed bookings read per tick; more than one tick can expire, so `due` shows the backlog. */
export const SWEEP_PAGE = 10;
/** Event configs read at a time when choosing what to repair next. */
const EVENTS_PAGE = 20;
/** Events awaiting priority repair, kept small so the state stays one small KV value. */
const MAX_DIRTY = 50;
/** Events whose counters are repaired on the rolling pass (others cannot sell). */
const SELLING = ["on_sale", "paused"];

/** What `sweep-holds` keeps between ticks. */
export interface SweepState {
	/** The drift repair in progress. */
	repair?: RepairJob | null;
	/** Events whose counters an expiry left uncertain: repaired before the rolling pass. */
	dirty?: string[];
	/** The rolling pass: events still to repair, and the cursor of the next page of configs. */
	queue?: string[];
	eventsCursor?: string | null;
}

type Page = { items: Array<{ id: string; data: unknown }>; hasMore?: boolean; cursor?: string };

export type SweepStorage = Omit<InventoryStorage, "bookings" | "event_configs"> & {
	bookings: HoldStorage["bookings"] & InventoryStorage["bookings"] & { get(id: string): Promise<unknown> };
	event_configs: InventoryStorage["event_configs"] & { query(options: unknown): Promise<Page> };
};

export type SweepKv = StateKv;

export interface SweepCron {
	schedule(name: string, opts: { schedule: string; data?: Record<string, unknown> }): Promise<void>;
}

export interface SweepDeps {
	storage: SweepStorage;
	kv: SweepKv;
	cron?: SweepCron;
	now: number;
	maxCalls?: number;
}

export interface SweepReport {
	/** Bridge calls made. */
	calls: number;
	expired: number;
	closed: number;
	/** Lapsed holds left for the next tick. */
	backlog: number;
	continued: boolean;
	repaired: number;
	conflicted: number;
}

const addDirty = (dirty: string[], ids: Iterable<string>) => {
	const next = [...dirty];
	for (const id of ids) if (!next.includes(id)) next.push(id);
	return next.slice(-MAX_DIRTY);
};

const dirtyEvents = (outcomes: ExpiryOutcome[]) => outcomes.filter((o) => o.dirty).map((o) => o.eventId);

const extraCalls = (outcomes: ExpiryOutcome[], planned: ReturnType<typeof planExpiries>["planned"]) =>
	outcomes.reduce((n, o, i) => n + (o.outcome === "restored" ? (planned[i]?.refs.length ?? 0) : 0), 0);

/** One `sweep-holds` tick. */
export async function sweepHolds({
	storage,
	kv,
	cron,
	now,
	maxCalls = SWEEP_MAX_CALLS,
}: SweepDeps): Promise<SweepReport> {
	const [stored, page] = await Promise.all([
		kv.getVersioned<SweepState>(SWEEP_STATE_KEY),
		storage.bookings.query({
			where: { status: { in: [...EXPIRABLE_STATUSES] }, holdExpiresAt: { lt: iso(now) } },
			orderBy: { holdExpiresAt: "asc" },
			limit: SWEEP_PAGE,
		}),
	]);
	let calls = 2;
	const job = jobState<SweepState>(kv, SWEEP_STATE_KEY, stored);
	const state = job.value;

	// Expiries first, keeping one call for the state write and, with a backlog, one for the continuation.
	const budget = maxCalls - calls - 1;
	let plan = planExpiries(page.items, now, budget);
	const backlogged = Boolean(page.hasMore) || plan.due > plan.planned.length;
	let continued = false;
	if (backlogged && cron) {
		const smaller = planExpiries(page.items, now, budget - 1);
		if (smaller.planned.length > 0 || plan.planned.length === 0) {
			plan = smaller;
			continued = true;
		}
	}
	const outcomes = await expireBookings(storage, plan.planned, now);
	calls += expiryCalls(plan.planned) + extraCalls(outcomes, plan.planned);
	const uncertain = dirtyEvents(outcomes);
	if (uncertain.length > 0) state.dirty = addDirty(state.dirty ?? [], uncertain);
	if (continued && cron) {
		await cron.schedule(SWEEP_MORE_TASK, { schedule: iso(now) });
		calls++;
	}

	// Drift repair with whatever is left, resuming the job in KV.
	let repaired = 0;
	let conflicted = 0;
	for (;;) {
		const left = maxCalls - calls - 1;
		if (left <= 0) break;
		if (!state.repair) {
			let next = state.dirty?.shift() ?? state.queue?.shift();
			if (!next) {
				const events = await storage.event_configs.query({
					where: { status: { in: SELLING } },
					limit: EVENTS_PAGE,
					...(state.eventsCursor ? { cursor: state.eventsCursor } : {}),
				});
				calls++;
				const wrapped = !state.eventsCursor;
				state.queue = events.items.map((i) => i.id);
				state.eventsCursor = events.hasMore && events.cursor ? events.cursor : null;
				next = state.queue.shift();
				if (!next && wrapped) break;
				if (!next) continue;
			}
			state.repair = { eventId: next };
			continue;
		}
		const step = await repairStep(storage, state.repair, now, left);
		calls += step.calls;
		repaired += step.repaired.length;
		conflicted += step.conflicted.length;
		if (step.conflicted.length > 0) state.dirty = addDirty(state.dirty ?? [], [state.repair.eventId]);
		state.repair = step.job;
		if (step.calls === 0) break;
	}

	if (!state.repair) delete state.repair;
	if (state.dirty?.length === 0) delete state.dirty;
	calls += await job.save();
	const counted = (o: ExpiryOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).length;
	return {
		calls,
		expired: counted("expired"),
		closed: counted("closed"),
		backlog: Math.max(0, plan.due - plan.planned.length) + (page.hasMore ? 1 : 0),
		continued,
		repaired,
		conflicted,
	};
}

/** Add events to the sweeper's priority repair list (two calls). */
async function markDirty(kv: SweepKv, eventIds: string[]): Promise<void> {
	if (eventIds.length === 0) return;
	const job = jobState<SweepState>(kv, SWEEP_STATE_KEY, await kv.getVersioned<SweepState>(SWEEP_STATE_KEY));
	job.value.dirty = addDirty(job.value.dirty ?? [], eventIds);
	await job.save(true);
}

export type HoldTaskResult = "expired" | "closed" | "rearmed" | "ignored";

/**
 * A `hold-<ref>` one-shot: expire that booking if its hold has lapsed. If the hold was extended
 * since the task was scheduled, re-arm the task for the new expiry. At most 8 bridge calls: read,
 * claim, ≤ 3 releases, move, and a dirty mark (two calls) when the counters may be off.
 */
export async function expireHoldTask(
	{ storage, kv, cron, now }: SweepDeps,
	bookingId: string,
): Promise<HoldTaskResult> {
	const booking = (await storage.bookings.get(bookingId)) as BookingDoc | null;
	if (!booking) return "ignored";
	if (!expiryAction(booking, now)) {
		const expires = msOf(booking.holdExpiresAt);
		if (cron && HOLD_STATUSES.includes(booking.status) && !booking.releaseClaimedAt && expires > now) {
			await cron.schedule(holdTaskName(booking.ref), {
				schedule: iso(expires),
				data: { bookingId },
			});
			return "rearmed";
		}
		return "ignored";
	}
	const { planned } = planExpiries([{ id: bookingId, data: booking }], now, SWEEP_MAX_CALLS - 3);
	const outcomes = await expireBookings(storage, planned, now);
	await markDirty(kv, dirtyEvents(outcomes));
	const outcome = outcomes[0]?.outcome;
	return outcome === "expired" || outcome === "closed" ? outcome : "ignored";
}

/** Schedule the accelerator for a booking's hold (one call; the same name replaces a pending task). */
export function scheduleHoldTask(cron: SweepCron, booking: { id: string; ref: string; holdExpiresAt: string }) {
	return cron.schedule(holdTaskName(booking.ref), { schedule: booking.holdExpiresAt, data: { bookingId: booking.id } });
}

/** The `cron` hook: dispatch by task name. */
export async function runCron(
	event: { name: string; data?: Record<string, unknown> },
	ctx: PluginContext,
	clock: () => number = Date.now,
): Promise<void> {
	const deps: SweepDeps = {
		storage: ctx.storage as unknown as SweepStorage,
		kv: ctx.kv,
		...(ctx.cron ? { cron: ctx.cron } : {}),
		now: clock(),
	};
	if (event.name === SWEEP_TASK || event.name === SWEEP_MORE_TASK) {
		await sweepHolds(deps);
	} else if (event.name.startsWith(HOLD_TASK_PREFIX) && typeof event.data?.bookingId === "string") {
		await expireHoldTask(deps, event.data.bookingId);
	}
}

/** `plugin:activate`: (re)schedule the recurring sweeper. */
export async function scheduleSweeper(ctx: PluginContext): Promise<void> {
	await ctx.cron?.schedule(SWEEP_TASK, { schedule: SWEEP_SCHEDULE });
}
