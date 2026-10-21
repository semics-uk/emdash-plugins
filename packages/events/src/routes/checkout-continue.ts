import { type ErrorCode, generateToken, toRouteError, verifyToken } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type SweepCron, scheduleHoldTask } from "../cron/sweep";
import {
	type AttendeeInput,
	checkoutState,
	confirmationMessage,
	confirmationOutboxId,
	nextStep,
	planAttendees,
} from "../domain/booking-state";
import { type InputIssue, parseContinueInput } from "../domain/checkout";
import { extendHold, holdSettings, stepTarget } from "../domain/holds";
import { type CounterStorage, confirmSold, countersForBooking } from "../domain/inventory";
import type { AttendeeStatus, BookingDoc, BookingStatus } from "../storage/schema";

/**
 * `POST public/checkout/continue` (EV-FR-05, EV-FR-07, R9): the step after `checkout/reserve`.
 * Authenticated by the booking ref and the access token reserve returned (both in the body; a
 * wrong token answers exactly like an unknown ref). It writes the attendees and returns `next`:
 * a free booking is confirmed here and its confirmation email queued (`{ type: "done" }`); a paid
 * one moves to `awaiting_payment` through the Pro payment step (`{ type: "pay", url }`). Free has
 * no payment provider, so it refuses paid bookings without touching them.
 *
 * Idempotent: a replay of a confirmed booking writes nothing once its confirmation is queued (the
 * queued message is the marker that the attendees were written, because it is written after
 * them). Every booking write is guarded on the status read and `releaseClaimedAt: null`; a miss
 * means the hold lapsed (`HOLD_EXPIRED`) unless a concurrent continue confirmed it first.
 *
 * Bridge calls (R22: hard limit 10, design target 8), confirming a free booking:
 * 1. `bookings.query` by `ref` (1).
 * 2. `bookings.updateIf` → `confirmed` (1).
 * 3. `confirmSold`: one write per counter (ticket types, occurrence, event; ≤ 5 for any order
 *    reserve accepts). Not retried: if it misses or the invocation dies, `sold` stays low and the
 *    sweeper's drift repair recomputes it from confirmed bookings, so a replay never counts twice.
 * 4. `attendees.putMany` (1), then `outbox.put` of the confirmation (1).
 * A one-ticket-type order is 5 calls; the largest is 9. A replay is 2 (query, `outbox.get`).
 * The paid step: query, `settings.list`, `extendHold` (status + hold in one write), attendees,
 * the `hold-<ref>` re-arm, then the provider's own calls.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;

export const CONTINUE_MAX_CALLS = 10;
export const CONTINUE_TARGET_CALLS = 8;

type Where = Record<string, unknown>;
type Item = { id: string; data: unknown };

export interface ContinueStorage extends CounterStorage {
	bookings: {
		get(id: string): Promise<unknown>;
		query(options: { where: Where; limit: number }): Promise<{ items: Item[] }>;
		updateIf(id: string, args: { where: Where; set?: Where }): Promise<{ applied: boolean }>;
	};
	attendees: { putMany(items: Item[]): Promise<void> };
	outbox: { get(id: string): Promise<unknown>; put(id: string, data: unknown): Promise<void> };
}

/** The Pro payment step: create the provider's checkout session for a booking awaiting payment. */
export interface PaymentStep {
	start(args: { bookingId: string; booking: BookingDoc; holdExpiresAt: string }): Promise<{ url: string }>;
}

export interface ContinueDeps {
	storage: ContinueStorage;
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	cron?: SweepCron;
	/** Absent in the Free edition. */
	payment?: PaymentStep;
	now: number;
	/** Check-in codes (default: a 256-bit opaque token). */
	newCode?: () => string;
}

const fail = (code: ErrorCode) => toRouteError(code).body;
const badRequest = (issues: InputIssue[]) => ({ ...fail("BAD_REQUEST"), issues });
const iso = (ms: number) => new Date(ms).toISOString();

/** Calls `confirm` keeps for the attendee and outbox writes after counting the sale. */
const AFTER_SOLD_CALLS = 2;

interface Checkout {
	deps: ContinueDeps;
	id: string;
	attendees: readonly AttendeeInput[] | undefined;
}

const done = (b: Pick<BookingDoc, "ref">) => ({
	ok: true as const,
	bookingRef: b.ref,
	status: "confirmed" as const,
	next: { type: "done" as const, bookingRef: b.ref },
});

function attendeesFor(c: Checkout, b: BookingDoc, status: AttendeeStatus, attendees: Checkout["attendees"]) {
	return planAttendees(c.id, b, attendees, { status, newCode: c.deps.newCode ?? (() => generateToken()) });
}

/** Write the attendees, then queue the confirmation (two calls). */
async function fulfil(c: Checkout, b: BookingDoc, docs: Item[]): Promise<void> {
	await c.deps.storage.attendees.putMany(docs);
	await c.deps.storage.outbox.put(confirmationOutboxId(c.id), confirmationMessage(c.id, b, c.deps.now));
}

/**
 * A confirmed booking: done once its confirmation is queued. Otherwise the confirming invocation
 * died before its side effects, so write them now (with the given attendees when they still fit,
 * else the buyer's name), without counting the sale again.
 */
async function finishConfirmed(c: Checkout, b: BookingDoc): Promise<unknown> {
	if (await c.deps.storage.outbox.get(confirmationOutboxId(c.id))) return done(b);
	let planned = attendeesFor(c, b, "valid", c.attendees);
	if (!planned.ok) planned = attendeesFor(c, b, "valid", undefined);
	await fulfil(c, b, planned.ok ? planned.value : []);
	return done(b);
}

async function confirm(c: Checkout, b: BookingDoc, docs: Item[]): Promise<unknown> {
	const { storage, now } = c.deps;
	const { applied } = await storage.bookings.updateIf(c.id, {
		where: { status: b.status, holdExpiresAt: b.holdExpiresAt, releaseClaimedAt: null },
		set: { status: "confirmed", confirmedAt: iso(now) },
	});
	if (!applied) {
		// Claimed by an expirer (the hold lapsed), or confirmed by a concurrent continue.
		const fresh = (await storage.bookings.get(c.id)) as BookingDoc | null;
		return fresh?.status === "confirmed" ? finishConfirmed(c, fresh) : fail("HOLD_EXPIRED");
	}
	const room = CONTINUE_MAX_CALLS - 2 - AFTER_SOLD_CALLS;
	await confirmSold(storage, countersForBooking(b).slice(0, room)).catch(() => undefined);
	await fulfil(c, b, docs);
	return done(b);
}

/** The Pro payment step: extend the hold, move to `awaiting_payment`, re-arm `hold-<ref>`. */
async function pay(c: Checkout, b: BookingDoc, status: BookingStatus, docs: Item[]): Promise<unknown> {
	const { storage, now, payment, cron } = c.deps;
	if (!payment) return fail("PAYMENT_FAILED");
	const entries = await c.deps.settings.list();
	const settings = holdSettings(Object.fromEntries(entries.map((e) => [e.key, e.value])));
	const until = stepTarget(now, { paid: true }, settings);
	const extended = await extendHold(storage.bookings, c.id, b, now, until, b.status === status ? {} : { status });
	if (!extended.ok) return fail(extended.error.code === "CONFLICT" ? "INTERNAL" : "HOLD_EXPIRED");
	const { holdExpiresAt } = extended.value;
	await storage.attendees.putMany(docs);
	if (cron) await scheduleHoldTask(cron, { id: c.id, ref: b.ref, holdExpiresAt }).catch(() => undefined);
	const session = await payment.start({ bookingId: c.id, booking: { ...b, status, holdExpiresAt }, holdExpiresAt });
	return { ok: true, bookingRef: b.ref, status, holdExpiresAt, next: { type: "pay", url: session.url } };
}

export async function continueCheckout(deps: ContinueDeps, raw: unknown): Promise<unknown> {
	const parsed = parseContinueInput(raw);
	if (!parsed.ok) return badRequest(parsed.error);
	const input = parsed.value;

	const { items } = await deps.storage.bookings.query({ where: { ref: input.bookingRef }, limit: 1 });
	const found = items[0];
	const booking = found?.data as BookingDoc | undefined;
	if (!found || !booking || !(await verifyToken(input.accessToken, booking.accessTokenHash))) {
		return fail("NOT_FOUND");
	}
	const c: Checkout = { deps, id: found.id, attendees: input.attendees };

	switch (checkoutState(booking, deps.now)) {
		case "confirmed":
			return finishConfirmed(c, booking);
		case "pending":
			// Reserve is still writing this booking: the client should retry in a moment.
			return fail("INTERNAL");
		case "lapsed":
		case "closed":
			return fail("HOLD_EXPIRED");
	}
	// Waivers are Pro: the Free edition never has a signature pending.
	const step = nextStep(booking, { signaturePending: false });
	if (!step || step.type === "sign") return fail("INTERNAL");
	const planned = attendeesFor(c, booking, step.type === "done" ? "valid" : "pending", c.attendees);
	if (!planned.ok) return badRequest(planned.error);
	return step.type === "done"
		? confirm(c, booking, planned.value)
		: pay(c, booking, step.status, planned.value);
}

export const CHECKOUT_CONTINUE_ROUTE: RouteDef = {
	methods: ["POST"],
	public: true,
	handler: (async (routeCtx: { input?: unknown }, ctx: PluginContext) =>
		continueCheckout(
			{
				storage: ctx.storage as unknown as ContinueStorage,
				settings: ctx.settings,
				...(ctx.cron ? { cron: ctx.cron } : {}),
				now: Date.now(),
			},
			routeCtx.input,
		)) as Handler,
};
