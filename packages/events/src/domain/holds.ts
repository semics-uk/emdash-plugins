/**
 * Seat holds (EV-FR-06, EV-US-2, R1): how long a checkout may keep its seats, step extensions up to
 * the ceiling, and expiry. Time is always passed in (`now`, epoch ms); nothing here reads a clock.
 *
 * A hold starts when the booking is written: 15 min for a free checkout, 35 min for a paid one
 * (Stripe Checkout's `expires_at` must be at least 30 min out), never past `holdCeilingAt`, which is
 * fixed at the start (default 60 min). Each checkout step extends `holdExpiresAt` towards the ceiling
 * and never past it; a lapsed hold cannot be revived (the sweeper may already have released it).
 *
 * Expiry is a three-step protocol, so that two expirers (the `sweep-holds` tick and a `hold-<ref>`
 * one-shot, or two overlapping ticks) never release the same seats twice, and so that drift repair
 * never sees a booking as gone while its seats are still counted (the inventory ordering contract):
 * 1. **claim**: `updateIf` the booking from its read `status` + `holdExpiresAt` with
 *    `releaseClaimedAt: null`, setting `releaseClaimedAt`. Only one expirer wins.
 * 2. **release** the seats (`release` from the inventory module), merged per counted document.
 * 3. **move** to `expired`, guarded on the claim. A miss means another writer changed the booking
 *    after the claim, so the seats are taken back (`restore`): an over-count is the safe direction.
 *
 * Writers that change a held booking (extend, confirm, cancel) guard on `releaseClaimedAt: null`
 * so they cannot race an expirer. A claim older than `CLAIM_STALE_MS` belongs to a crashed
 * invocation: the booking is moved to `expired` without releasing (it may or may not have
 * released), and the event is marked for drift repair. A `draft` past its hold never reached
 * `held`; whether its reservation committed is unknown, so it too is closed without releasing.
 */
import { err, ok, type Result } from "@semics-tech/shared";

import type { BookingDoc, BookingStatus } from "../storage/schema";
import {
	type CounterRef,
	type CounterStorage,
	countersForBooking,
	DRAFT_GRACE_MS,
	mergeRefs,
	release,
	restore,
} from "./inventory";

const MINUTE = 60_000;

export interface HoldSettings {
	freeMinutes: number;
	paidMinutes: number;
	ceilingMinutes: number;
}

/** Manifest defaults (`holdMinutesFree`, `holdMinutesPaid`, `holdCeilingMinutes`). */
export const DEFAULT_HOLD_SETTINGS: HoldSettings = { freeMinutes: 15, paidMinutes: 35, ceilingMinutes: 60 };

/** Ranges from the manifest's settings schema; paid holds cover Stripe's 30-minute minimum. */
const RANGES = {
	freeMinutes: [5, 60],
	paidMinutes: [30, 60],
	ceilingMinutes: [15, 120],
} as const satisfies Record<keyof HoldSettings, readonly [number, number]>;

/** Hold settings from raw plugin settings: missing or invalid values fall back, others are clamped. */
export function holdSettings(raw: {
	holdMinutesFree?: unknown;
	holdMinutesPaid?: unknown;
	holdCeilingMinutes?: unknown;
}): HoldSettings {
	const pick = (value: unknown, key: keyof HoldSettings) => {
		if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HOLD_SETTINGS[key];
		const [min, max] = RANGES[key];
		return Math.min(max, Math.max(min, Math.round(value)));
	};
	return {
		freeMinutes: pick(raw.holdMinutesFree, "freeMinutes"),
		paidMinutes: pick(raw.holdMinutesPaid, "paidMinutes"),
		ceilingMinutes: pick(raw.holdCeilingMinutes, "ceilingMinutes"),
	};
}

/** Booking statuses that hold seats with a running hold. */
export const HOLD_STATUSES: readonly BookingStatus[] = ["held", "awaiting_signature", "awaiting_payment"];

/** Statuses the sweeper expires: the hold states, plus a `draft` whose checkout never finished. */
export const EXPIRABLE_STATUSES: readonly BookingStatus[] = ["draft", ...HOLD_STATUSES];

/** A claim older than this belongs to an invocation that died (the host stops one after 30 s). */
export const CLAIM_STALE_MS = 2 * MINUTE;

const iso = (ms: number) => new Date(ms).toISOString();

/** The hold a new booking starts with. */
export function startHold(
	now: number,
	{ paid }: { paid: boolean },
	settings: HoldSettings = DEFAULT_HOLD_SETTINGS,
): { holdExpiresAt: string; holdCeilingAt: string } {
	const ceiling = now + settings.ceilingMinutes * MINUTE;
	const expires = Math.min(ceiling, now + (paid ? settings.paidMinutes : settings.freeMinutes) * MINUTE);
	return { holdExpiresAt: iso(expires), holdCeilingAt: iso(ceiling) };
}

/** The extension target for a checkout step: one more hold period from now (capped by the ceiling). */
export function stepTarget(now: number, { paid }: { paid: boolean }, settings: HoldSettings = DEFAULT_HOLD_SETTINGS) {
	return now + (paid ? settings.paidMinutes : settings.freeMinutes) * MINUTE;
}

/** The hold fields of a booking, plus the expiry claim (absent and `null` both mean unclaimed). */
export type HoldFields = Pick<BookingDoc, "status" | "holdExpiresAt" | "holdCeilingAt"> & {
	releaseClaimedAt?: string | null;
};

export type ExtendError = { code: "NOT_HELD" } | { code: "HOLD_LAPSED" };

/**
 * The new `holdExpiresAt` for a step that wants the hold to last until `until`: never earlier than
 * now held, never past the ceiling. Pure.
 */
export function planExtension(
	booking: HoldFields,
	now: number,
	until: number,
): Result<{ holdExpiresAt: string; changed: boolean; atCeiling: boolean }, ExtendError> {
	if (!HOLD_STATUSES.includes(booking.status)) return err({ code: "NOT_HELD" });
	const current = Date.parse(booking.holdExpiresAt ?? "");
	if (!Number.isFinite(current)) return err({ code: "NOT_HELD" });
	if (booking.releaseClaimedAt || current <= now) return err({ code: "HOLD_LAPSED" });
	const parsedCeiling = Date.parse(booking.holdCeilingAt ?? "");
	const ceiling = Number.isFinite(parsedCeiling) ? Math.max(parsedCeiling, current) : current;
	const next = Math.min(ceiling, Math.max(current, until));
	return ok({ holdExpiresAt: iso(next), changed: next > current, atCeiling: next >= ceiling });
}

/** The subset of a storage collection the hold functions use. */
export interface BookingCollection {
	updateIf(
		id: string,
		args: { where: Record<string, unknown>; set?: Record<string, unknown> },
	): Promise<{ applied: boolean; data?: unknown }>;
}

export interface HoldStorage extends CounterStorage {
	bookings: BookingCollection;
}

/**
 * Extend a hold for a checkout step, in one guarded write (none when already at the ceiling).
 * `set` carries the step's own changes (for example the next status), written in the same update.
 * `CONFLICT` means the booking changed since it was read (re-read and retry, or treat as lapsed).
 */
export async function extendHold(
	bookings: BookingCollection,
	id: string,
	booking: HoldFields,
	now: number,
	until: number,
	set: Record<string, unknown> = {},
): Promise<Result<{ holdExpiresAt: string; atCeiling: boolean }, ExtendError | { code: "CONFLICT" }>> {
	const plan = planExtension(booking, now, until);
	if (!plan.ok) return plan;
	const { holdExpiresAt, changed, atCeiling } = plan.value;
	if (!changed && Object.keys(set).length === 0) return ok({ holdExpiresAt, atCeiling });
	const { applied } = await bookings.updateIf(id, {
		where: { status: booking.status, holdExpiresAt: booking.holdExpiresAt, releaseClaimedAt: null },
		set: { ...set, holdExpiresAt },
	});
	return applied ? ok({ holdExpiresAt, atCeiling }) : err({ code: "CONFLICT" });
}

// --- expiry ----------------------------------------------------------------------------------------

export type ExpiringBooking = Pick<BookingDoc, "eventId" | "occurrenceId" | "lines" | "status" | "createdAt"> &
	HoldFields;

/**
 * What an expirer should do with a booking now: `release` its seats (claim, release, move),
 * `close` it without releasing (a stale claim or a dead draft; drift repair settles the counters),
 * or nothing (`null`: not due, or another expirer is on it).
 */
export function expiryAction(b: ExpiringBooking, now: number): "release" | "close" | null {
	if (!EXPIRABLE_STATUSES.includes(b.status)) return null;
	if (b.releaseClaimedAt) {
		const claimed = Date.parse(b.releaseClaimedAt);
		return !Number.isFinite(claimed) || now - claimed >= CLAIM_STALE_MS ? "close" : null;
	}
	const expires = Date.parse(b.holdExpiresAt ?? "");
	if (!Number.isFinite(expires) || expires > now) return null;
	if (b.status === "draft") return now - Date.parse(b.createdAt) >= DRAFT_GRACE_MS ? "close" : null;
	return "release";
}

export interface PlannedExpiry {
	id: string;
	booking: ExpiringBooking;
	action: "release" | "close";
	refs: CounterRef[];
}

/** Bridge calls a set of planned expiries makes: claims, merged releases, moves. */
export function expiryCalls(planned: readonly PlannedExpiry[]): number {
	const releasing = planned.filter((p) => p.action === "release");
	return releasing.length + mergeRefs(releasing.flatMap((p) => p.refs)).length + planned.length;
}

/**
 * Pick, in order, the due bookings whose expiry fits `maxCalls` (no item is skipped to fit a later
 * one, so the oldest holds go first). Pure.
 */
export function planExpiries(
	items: ReadonlyArray<{ id: string; data: unknown }>,
	now: number,
	maxCalls: number,
): { planned: PlannedExpiry[]; due: number } {
	const planned: PlannedExpiry[] = [];
	let due = 0;
	let full = false;
	for (const item of items) {
		const booking = item.data as ExpiringBooking;
		const action = expiryAction(booking, now);
		if (!action) continue;
		due++;
		if (full) continue;
		const next: PlannedExpiry = {
			id: item.id,
			booking,
			action,
			refs: action === "release" ? countersForBooking(booking) : [],
		};
		if (expiryCalls([...planned, next]) > maxCalls) full = true;
		else planned.push(next);
	}
	return { planned, due };
}

export interface ExpiryOutcome {
	id: string;
	eventId: string;
	outcome: "expired" | "closed" | "skipped" | "restored";
	/** True when the event's counters may be off and need drift repair. */
	dirty: boolean;
}

/**
 * Run planned expiries (`planExpiries`): claims in parallel, one merged release per counted
 * document, then the guarded moves. Makes exactly `expiryCalls(planned)` bridge calls, plus a
 * `restore` per document of a booking whose move lost a race (which the guarded writers prevent).
 */
export async function expireBookings(
	storage: HoldStorage,
	planned: PlannedExpiry[],
	now: number,
): Promise<ExpiryOutcome[]> {
	const at = iso(now);
	const claimed = await Promise.all(
		planned.map(async (p) => {
			if (p.action === "close") return true;
			const { applied } = await storage.bookings
				.updateIf(p.id, {
					where: { status: p.booking.status, holdExpiresAt: p.booking.holdExpiresAt, releaseClaimedAt: null },
					set: { releaseClaimedAt: at },
				})
				.catch(() => ({ applied: false }));
			return applied;
		}),
	);
	const releasing = planned.filter((p, i) => p.action === "release" && claimed[i]);
	const unreleased = await release(storage, mergeRefs(releasing.flatMap((p) => p.refs)));
	const unreleasedDocs = new Set(unreleased.map((r) => `${r.collection}/${r.id}`));

	return Promise.all(
		planned.map(async (p, i): Promise<ExpiryOutcome> => {
			const base = { id: p.id, eventId: p.booking.eventId };
			if (!claimed[i]) return { ...base, outcome: "skipped", dirty: false };
			const guard =
				p.action === "release"
					? { status: p.booking.status, releaseClaimedAt: at }
					: p.booking.releaseClaimedAt
						? { status: p.booking.status, releaseClaimedAt: p.booking.releaseClaimedAt }
						: { status: p.booking.status, holdExpiresAt: p.booking.holdExpiresAt, releaseClaimedAt: null };
			const { applied } = await storage.bookings
				.updateIf(p.id, { where: guard, set: { status: "expired", expiredAt: at } })
				.catch(() => ({ applied: false }));
			const partly = p.refs.some((r) => unreleasedDocs.has(`${r.collection}/${r.id}`));
			if (applied) {
				return p.action === "release"
					? { ...base, outcome: "expired", dirty: partly }
					: { ...base, outcome: "closed", dirty: true };
			}
			if (p.action === "close") return { ...base, outcome: "skipped", dirty: false };
			await restore(
				storage,
				p.refs.filter((r) => !unreleasedDocs.has(`${r.collection}/${r.id}`)),
			);
			return { ...base, outcome: "restored", dirty: true };
		}),
	);
}

// --- one-shot accelerator tasks ---------------------------------------------------------------------

/** Prefix of the one-shot cron task that expires one booking's hold on time. */
export const HOLD_TASK_PREFIX = "hold-";

/** Cron task names: letters, digits, `-`, `_`; at most 128 characters (S3). */
export function holdTaskName(ref: string): string {
	return `${HOLD_TASK_PREFIX}${ref.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 128);
}
