import { type ErrorCode, toRouteError, verifyToken } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { canTransition } from "../domain/booking-state";
import { type CancelDecision, cancelCutoffHours, cancelDecision } from "../domain/cancel-policy";
import { type InputIssue, parseBookingAccessInput } from "../domain/checkout";
import { CLAIM_STALE_MS, HOLD_STATUSES } from "../domain/holds";
import { type CounterStorage, countersForBooking, release } from "../domain/inventory";
import type { LinkKv } from "../domain/link-secret";
import type { BookingDoc, EventConfigDoc, OutboxDoc } from "../storage/schema";
import { bookingCalendarQuery } from "./ics";

/**
 * `POST public/booking` (status) and `POST public/booking/cancel` (EV-US-4, EV-FR-09). Both are
 * authenticated by `{ bookingRef, accessToken }` in the body: one `bookings.query` on the unique
 * `ref`, then `verifyToken`. A wrong token answers exactly like an unknown ref (`NOT_FOUND`), and an
 * unknown ref still runs a token check, so the two cannot be told apart by time.
 *
 * Cancel follows the T045 claim rule: it claims the booking (`releaseClaimedAt`, guarded on the
 * status read), releases the seats (`sold` too for a confirmed booking), then moves the status to
 * `cancelled` guarded on its own claim, and queues the notice. A booking being held or paid for
 * may always be abandoned; a confirmed one only until `cancelCutoffHours` before the event starts
 * (`src/domain/cancel-policy.ts`). A cancelled booking answers ok on a replay and writes nothing.
 * Refunding a paid booking is a separate step (Pro).
 *
 * Bridge calls (R22: hard limit 10, design target 8), cancelling a confirmed booking:
 * `bookings.query`, `event_configs.get`, `settings.list`, claim, one release per counter, move,
 * `outbox.put`: 6 plus the counters. One ticket type without an occurrence is 8. Counters beyond
 * the budget (event and occurrence go first) are left for the sweeper's drift repair, which counts
 * only live bookings. Abandoning a held booking skips the config and settings reads.
 * Status is query, attendees query, and for a confirmed booking the config and settings reads, plus
 * the calendar link's key read (the first use creates it): 5, or 7 on that first use.
 *
 * A confirmed booking's answer carries `calendar: { query }`, a 15-minute signed query for
 * `public/booking/ics` (T050), and each valid attendee's check-in `code` (R33): only the token
 * holder sees them, and neither travels in a URL or an email.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;

export const BOOKING_MAX_CALLS = 10;
export const BOOKING_TARGET_CALLS = 8;

type Where = Record<string, unknown>;
type Item = { id: string; data: unknown };

export interface BookingRouteStorage extends CounterStorage {
	bookings: {
		query(options: { where: Where; limit: number }): Promise<{ items: Item[] }>;
		updateIf(id: string, args: { where: Where; set?: Where }): Promise<{ applied: boolean }>;
	};
	attendees: { query(options: { where: Where; limit: number }): Promise<{ items: Item[] }> };
	event_configs: CounterStorage["event_configs"] & { get(id: string): Promise<unknown> };
	outbox: { put(id: string, data: unknown): Promise<void> };
}

export interface BookingDeps {
	storage: BookingRouteStorage;
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	/** Holds the calendar link key; without it the answer has no `calendar`. */
	kv?: LinkKv;
	now: number;
}

const fail = (code: ErrorCode) => toRouteError(code).body;
const badRequest = (issues: InputIssue[]) => ({ ...fail("BAD_REQUEST"), issues });
const iso = (ms: number) => new Date(ms).toISOString();

/** A token hash no real token matches, so an unknown ref pays for a check like a wrong token. */
const DECOY_HASH = "0".repeat(64);

/** Calls cancel keeps for everything but the counters: query, config, settings, claim, move, outbox. */
const CANCEL_FIXED_CALLS = 6;

interface Found {
	id: string;
	booking: BookingDoc;
}

async function authenticate(deps: BookingDeps, raw: unknown): Promise<Found | { error: unknown }> {
	const parsed = parseBookingAccessInput(raw);
	if (!parsed.ok) return { error: badRequest(parsed.error) };
	const { items } = await deps.storage.bookings.query({ where: { ref: parsed.value.bookingRef }, limit: 1 });
	const found = items[0];
	const booking = found?.data as BookingDoc | undefined;
	const valid = await verifyToken(parsed.value.accessToken, booking?.accessTokenHash ?? DECOY_HASH);
	if (!found || !booking || !valid) return { error: fail("NOT_FOUND") };
	return { id: found.id, booking };
}

/** The policy decision for a booking; a hold state is always cancellable and needs no reads. */
async function decide(deps: BookingDeps, b: BookingDoc): Promise<CancelDecision> {
	if (b.status !== "confirmed") return cancelDecision(b, null, 0, deps.now);
	const config = (await deps.storage.event_configs.get(b.eventId)) as EventConfigDoc | null;
	const entries = await deps.settings.list();
	const hours = cancelCutoffHours(Object.fromEntries(entries.map((e) => [e.key, e.value])));
	return cancelDecision(b, config, hours, deps.now);
}

export async function bookingStatus(deps: BookingDeps, raw: unknown): Promise<unknown> {
	const auth = await authenticate(deps, raw);
	if ("error" in auth) return auth.error;
	const { id, booking: b } = auth;
	const [{ items }, decision, calendar] = await Promise.all([
		deps.storage.attendees.query({ where: { bookingId: id }, limit: 100 }),
		decide(deps, b),
		b.status === "confirmed" && deps.kv
			? bookingCalendarQuery(deps.kv, b.ref, deps.now).catch(() => undefined)
			: undefined,
	]);
	return {
		ok: true,
		bookingRef: b.ref,
		status: b.status,
		eventId: b.eventId,
		...(b.occurrenceId !== undefined ? { occurrenceId: b.occurrenceId } : {}),
		buyer: b.buyer,
		lines: b.lines,
		totals: b.totals,
		...(b.holdExpiresAt !== undefined && HOLD_STATUSES.includes(b.status) ? { holdExpiresAt: b.holdExpiresAt } : {}),
		attendees: items.map((i) => {
			const a = i.data as { name: string; ticketTypeId: string; status: string; code?: string };
			return {
				name: a.name,
				ticketTypeId: a.ticketTypeId,
				status: a.status,
				...(a.status === "valid" && a.code ? { code: a.code } : {}),
			};
		}),
		...(calendar ? { calendar: { query: calendar } } : {}),
		canCancel: decision.allowed,
		...(decision.cancelBy ? { cancelBy: decision.cancelBy } : {}),
	};
}

function cancellationMessage(id: string, b: BookingDoc, now: number): OutboxDoc {
	return {
		kind: "booking_cancelled",
		to: b.email,
		payload: { bookingId: id, bookingRef: b.ref },
		attempts: 0,
		nextAttemptAt: iso(now),
		status: "pending",
	};
}

export async function cancelBooking(deps: BookingDeps, raw: unknown): Promise<unknown> {
	const auth = await authenticate(deps, raw);
	if ("error" in auth) return auth.error;
	const { id, booking: b } = auth;
	const { storage, now } = deps;
	const cancelled = { ok: true, bookingRef: b.ref, status: "cancelled" };

	if (b.status === "cancelled") return cancelled;
	const held = HOLD_STATUSES.includes(b.status);
	const claimedAt = Date.parse(b.releaseClaimedAt ?? "");
	const claimLive = b.releaseClaimedAt != null && !(now - claimedAt >= CLAIM_STALE_MS);
	// A claimed hold is the expirer's (the sweeper finishes it); a live claim on a confirmed
	// booking is another cancel in flight.
	if (held && b.releaseClaimedAt != null) return fail("HOLD_EXPIRED");
	if (claimLive) return fail("INTERNAL");
	if (!canTransition(b.status, "cancelled")) return fail("CANCEL_NOT_ALLOWED");
	if (held && !(Date.parse(b.holdExpiresAt ?? "") > now)) return fail("HOLD_EXPIRED");

	const decision = await decide(deps, b);
	if (!decision.allowed) return fail("CANCEL_NOT_ALLOWED");

	const claim = iso(now);
	const claimed = await storage.bookings.updateIf(id, {
		where: { status: b.status, releaseClaimedAt: b.releaseClaimedAt ?? null },
		set: { releaseClaimedAt: claim },
	});
	if (!claimed.applied) return fail(held ? "HOLD_EXPIRED" : "INTERNAL");

	// Event and occurrence counters first: they decide whether the event sells out.
	const room = BOOKING_MAX_CALLS - (held ? CANCEL_FIXED_CALLS - 2 : CANCEL_FIXED_CALLS);
	const refs = countersForBooking(b).reverse().slice(0, Math.max(room, 0));
	await release(storage, refs, { sold: b.status === "confirmed" }).catch(() => undefined);

	const moved = await storage.bookings.updateIf(id, {
		where: { status: b.status, releaseClaimedAt: claim },
		set: { status: "cancelled", cancelledAt: claim },
	});
	if (!moved.applied) return fail("INTERNAL");
	await storage.outbox.put(`cancel-${id}`, cancellationMessage(id, b, now));
	return cancelled;
}

const handler =
	(fn: (deps: BookingDeps, raw: unknown) => Promise<unknown>): Handler =>
	async (routeCtx, ctx) =>
		fn(
			{ storage: ctx.storage as unknown as BookingRouteStorage, settings: ctx.settings, kv: ctx.kv, now: Date.now() },
			routeCtx.input,
		);

export const BOOKING_ROUTE: RouteDef = { methods: ["POST"], public: true, handler: handler(bookingStatus) as never };
export const BOOKING_CANCEL_ROUTE: RouteDef = {
	methods: ["POST"],
	public: true,
	handler: handler(cancelBooking) as never,
};
