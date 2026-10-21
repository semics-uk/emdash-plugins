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
	type BookingCollection,
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
import type { BookingDoc } from "../storage/schema";

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

export interface SweepKv {
	getVersioned<T>(key: string): Promise<{ value: T; revision: string } | null>;
	compareAndSet(key: string, expectedRevision: string | null, value: unknown): Promise<{ applied: boolean }>;
}

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

const iso = (ms: number) => new Date(ms).toISOString();

const addDirty = (dirty: string[], ids: Iterable<string>) => {
	const next = [...dirty];
	for (const id of ids) if (!next.includes(id)) next.push(id);
	return next.slice(-MAX_DIRTY);
};

const dirtyEvents = (outcomes: ExpiryOutcome[]) => outcomes.filter((o) => o.dirty).map((o) => o.eventId);

const extraCalls = (outcomes: ExpiryOutcome[], planned: ReturnType<typeof planExpiries>["planned"]) =>
	outcomes.reduce((n, o, i) => n + (o.outcome === "restored" ? (planned[i]?.refs.length ?? 0) : 0), 0);

/** One `sweep-holds` tick. */
export async function sweepHolds({ storage, kv, cron, now, maxCalls = SWEEP_MAX_CALLS }: SweepDeps): Promise<SweepReport> {
	throw new Error("T045: not implemented");
}

/** Add events to the sweeper's priority repair list (two calls). */
async function markDirty(kv: SweepKv, eventIds: string[]): Promise<void> {
	if (eventIds.length === 0) return;
	const stored = await kv.getVersioned<SweepState>(SWEEP_STATE_KEY);
	const state = { ...(stored?.value ?? {}) };
	state.dirty = addDirty(state.dirty ?? [], eventIds);
	await kv.compareAndSet(SWEEP_STATE_KEY, stored?.revision ?? null, state).catch(() => undefined);
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
	throw new Error("T045: not implemented");
}

/** Schedule the accelerator for a booking's hold (one call; the same name replaces a pending task). */
export function scheduleHoldTask(cron: SweepCron, booking: { id: string; ref: string; holdExpiresAt: string }) {
	throw new Error("T045: not implemented");
}

/** The `cron` hook: dispatch by task name. */
export async function runCron(
	event: { name: string; data?: Record<string, unknown> },
	ctx: PluginContext,
	clock: () => number = Date.now,
): Promise<void> {
	throw new Error("T045: not implemented");
}

/** `plugin:activate`: (re)schedule the recurring sweeper. */
export async function scheduleSweeper(ctx: PluginContext): Promise<void> {
	throw new Error("T045: not implemented");
}
