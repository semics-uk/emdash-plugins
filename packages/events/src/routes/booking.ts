import { verifyToken } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { canTransition, outboxRow } from "../domain/booking-state";
import { type CancelDecision, cancelCutoffHours, cancelDecision } from "../domain/cancel-policy";
import { parseBookingAccessInput } from "../domain/checkout";
import { CLAIM_STALE_MS, HOLD_STATUSES } from "../domain/holds";
import { type CounterStorage, countersForBooking, release } from "../domain/inventory";
import type { LinkKv } from "../domain/link-secret";
import {
	AWAITING_APPROVAL,
	AWAITING_SIGNATURE,
	allOf,
	CANCEL_NOT_ALLOWED,
	CANCELLED,
	CONFIRMED,
	ERROR,
	HOLD_EXPIRED,
	INTERNAL,
	maxOf,
	NOT_FOUND,
	PAYMENT_FAILED,
	PENDING,
} from "../domain/names";
import { readSettings } from "../domain/settings";
import { iso, msOf } from "../domain/time";
import type { BookingDoc, EventConfigDoc } from "../storage/schema";
import { bookingCalendarQuery } from "./ics";
import { badRequest, fail, publicPost } from "./reply";

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
 * A paid confirmed booking (`payment` is set, only by an edition that takes payments) is never
 * cancelled without its refund: Free refuses it (`CANCEL_NOT_ALLOWED`); an edition passes a
 * `RefundStep`, which runs after the claim and before the seats are released. A refused refund
 * clears the claim and answers `PAYMENT_FAILED`; the step's own calls (`calls`) come out of the
 * counters' room, and it may change the notice's `kind`/`payload` (T075).
 *
 * Bridge calls (R22: hard limit 10, design target 8), cancelling a confirmed booking:
 * `bookings.query`, `event_configs.get`, `settings.list`, claim, one release per counter, move,
 * `outbox.put`: 6 plus the counters. One ticket type without an occurrence is 8. Counters beyond
 * the budget (event and occurrence go first) are left for the sweeper's drift repair, which counts
 * only live bookings. Abandoning a held booking skips the config and settings reads.
 * Status is query, attendees query, the config read (the event's public info, T151, and for a
 * confirmed booking the cancel policy), and for a confirmed booking the settings read, plus the
 * calendar link's key read (the first use creates it): 5, or 7 on that first use; 3 for a held one. A waiver
 * booking's lookup requests (Pro) reuse a confirmed booking's settings read; awaiting signatures, +1.
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
	/** Pro (T066): a signed receipt-lookup request per ref, from the settings (the pairing). */
	lookups?: LookupStep;
	/** Pro (T075): refunds a paid booking. Without it a paid confirmed booking cannot be cancelled. */
	refund?: RefundStep;
	now: number;
}

/** Mints e-sign receipt-lookup requests (`esign-lookup/1`) for the refs; refs it cannot mint are left out. */
export type LookupStep = (refs: string[], settings: Record<string, unknown>) => Promise<Record<string, string>>;

/** Pro (T075): refunds a paid booking's payment during cancel; its settings are the ones cancel read. */
export interface RefundStep {
	/** Bridge calls `run` makes for this booking. */
	calls(b: BookingDoc): number;
	run(
		b: BookingDoc,
		settings: Record<string, unknown>,
		id: string,
	): Promise<{ ok: true; mail?: { kind: string; payload?: Record<string, unknown> } } | { ok: false }>;
}

/** Refs listed for reconciliation: a page load asks e-sign once per ref. */
const MAX_WAITING_REFS = 10;

/**
 * The refs of a waiver booking that e-sign may have news of (`<bookingRef>:<seat>`, or the booking's
 * own): seats with no receipt yet, and seats whose declined, voided or expired receipt is on record
 * but which continue has since sent a fresh intent for (`reissued`). A seat whose terminal receipt is
 * recorded and not followed by a new intent is not asked again (T067): e-sign would only answer
 * with the same receipt.
 */
function waitingRefs(b: BookingDoc, items: Item[]): string[] {
	const unsigned = items.filter((i) => {
		const signature = (i.data as { signature?: { status?: string; reissued?: boolean } }).signature;
		return !signature || (signature.status !== "completed" && signature.reissued === true);
	});
	if (unsigned.length === 0) return [];
	if (b.waiver?.mode === "buyer") return [b.ref];
	return unsigned.slice(0, MAX_WAITING_REFS).map((i) => `${b.ref}:${i.id.slice(i.id.lastIndexOf("-") + 1)}`);
}

/** Calls cancel keeps for everything but the counters: query, config, settings, claim, move, outbox. */
const CANCEL_FIXED_CALLS = 6;

interface Found {
	id: string;
	booking: BookingDoc;
}

/**
 * The booking `bookingRef` names, if `accessToken` is its token (one `bookings.query`); else null.
 * An unknown ref pays for a check like a wrong token (verifyToken's decoy, T100).
 */
export async function findByToken(
	storage: { bookings: { query(o: { where: Where; limit: number }): Promise<{ items: Item[] }> } },
	{ bookingRef, accessToken }: { bookingRef: string; accessToken: string },
): Promise<Found | null> {
	const { items } = await storage.bookings.query({ where: { ref: bookingRef }, limit: 1 });
	const found = items[0];
	const booking = found?.data as BookingDoc | undefined;
	const valid = await verifyToken(accessToken, booking?.accessTokenHash);
	return found && booking && valid ? { id: found.id, booking } : null;
}

async function authenticate(deps: BookingDeps, raw: unknown): Promise<Found | { error: unknown }> {
	const parsed = parseBookingAccessInput(raw);
	if (!parsed.ok) return { error: badRequest(parsed.error) };
	return (await findByToken(deps.storage, parsed.value)) ?? { error: fail(NOT_FOUND) };
}

/** The policy decision for a booking; a hold state is always cancellable and needs no reads. */
async function decide(
	deps: BookingDeps,
	b: BookingDoc,
	read?: Promise<unknown>,
): Promise<CancelDecision & { settings: Record<string, unknown> }> {
	if (b.status !== CONFIRMED) return { ...cancelDecision(b, null, 0, deps.now), settings: {} };
	const config = (await (read ?? deps.storage.event_configs.get(b.eventId))) as EventConfigDoc | null;
	const settings = await readSettings(deps);
	return { ...cancelDecision(b, config, cancelCutoffHours(settings), deps.now), settings };
}

export async function bookingStatus(deps: BookingDeps, raw: unknown): Promise<unknown> {
	const auth = await authenticate(deps, raw);
	if (ERROR in auth) return auth.error;
	const { id, booking: b } = auth;
	// One config read serves the cancel policy and the event's public info (T151: kept after it leaves sale).
	const read = deps.storage.event_configs.get(b.eventId);
	const [{ items }, decision, calendar, config] = await allOf([
		deps.storage.attendees.query({ where: { bookingId: id }, limit: 100 }),
		decide(deps, b, read),
		b.status === CONFIRMED && deps.kv
			? bookingCalendarQuery(deps.kv, b.ref, deps.now).catch(() => undefined)
			: undefined,
		read as Promise<EventConfigDoc | null>,
	]);
	const info = config?.info;
	// A booking waiting for signatures lists the refs to reconcile with e-sign (a signer who closed the
	// tab, or signed by email); with Pro's step it carries a lookup request for each (SX-FR-05). So does a
	// confirmed one for its seats still pending: an emailed adult whose return page never ran (no
	// JavaScript, tab closed) is recorded on the buyer's next visit (T119 F5).
	const confirmed = b.status === CONFIRMED;
	const pending = confirmed ? items.filter((i) => (i.data as { status?: string }).status === PENDING) : items;
	// Also while the organiser decides: guests can sign meanwhile, and only the buyer's visits record it.
	const refs =
		b.waiver && (confirmed || b.status === AWAITING_SIGNATURE || b.status === AWAITING_APPROVAL)
			? waitingRefs(b, pending)
			: [];
	const lookups =
		refs.length > 0 && deps.lookups
			? await deps.lookups(refs, confirmed ? decision.settings : await readSettings(deps))
			: undefined;
	// Free has no waivers (no lookups step): an attendee a Pro waiver left pending on a confirmed booking
	// gets their pass, and Free check-in admits them (R44, T119 F6).
	const passFor = (status: string) =>
		status === "valid" || (confirmed && !deps.lookups && b.waiver && status === PENDING);
	return {
		ok: true,
		bookingRef: b.ref,
		status: b.status,
		eventId: b.eventId,
		...(b.occurrenceId !== undefined ? { occurrenceId: b.occurrenceId } : {}),
		// The event's public info; `startsAt` is the booked date's (absent once that date leaves the catalog).
		...(info && {
			event: b.occurrenceId ? { ...info, startsAt: config.catalog?.occurrences[b.occurrenceId]?.startsAt } : info,
		}),
		buyer: b.buyer,
		lines: b.lines,
		totals: b.totals,
		declineReason: b.declineReason,
		notCharged: b.notCharged,
		// The hold became the approval's deadline (`settle`): an expired booking here lapsed waiting for the organiser,
		// unless they had approved it and only the payment was left (Pro's Pay now keeps that deadline).
		undecided: b.holdExpiresAt === b.approval?.until && !b.approval?.approvedAt,
		...(b.holdExpiresAt !== undefined && HOLD_STATUSES.includes(b.status) ? { holdExpiresAt: b.holdExpiresAt } : {}),
		attendees: items.map((i) => {
			const a = i.data as { name: string; ticketTypeId: string; status: string; code?: string };
			return {
				name: a.name,
				ticketTypeId: a.ticketTypeId,
				status: a.status,
				...(passFor(a.status) && a.code ? { code: a.code } : {}),
			};
		}),
		...(calendar ? { calendar: { query: calendar } } : {}),
		...(refs.length > 0 ? { waiver: { refs, ...(lookups ? { lookups } : {}) } } : {}),
		canCancel: decision.allowed,
		...(decision.cancelBy ? { cancelBy: decision.cancelBy } : {}),
	};
}

export async function cancelBooking(deps: BookingDeps, raw: unknown): Promise<unknown> {
	const auth = await authenticate(deps, raw);
	if (ERROR in auth) return auth.error;
	return closeBooking(deps, auth.id, auth.booking);
}

/**
 * Cancel `b` (the buyer), or decline it (an admin, T131: only while `awaiting_approval`; `reason` is
 * stored on it for the email). Both claim, refund a paid booking through the edition's step, release
 * the places and queue the notice (`cancel-<id>`, or `decline-<id>` of kind `approval_declined`).
 * `used`: bridge calls the caller already made beyond the booking read.
 */
export async function closeBooking(
	deps: BookingDeps,
	id: string,
	b: BookingDoc,
	decline?: { reason: string },
	used = 0,
): Promise<unknown> {
	const { storage, now } = deps;
	const to = decline ? "declined" : CANCELLED;
	const cancelled = { ok: true, bookingRef: b.ref, status: to };

	if (b.status === to) return cancelled;
	if (decline && b.status !== AWAITING_APPROVAL) return fail(CANCEL_NOT_ALLOWED);
	const held = HOLD_STATUSES.includes(b.status);
	const claimedAt = msOf(b.releaseClaimedAt);
	const claimLive = b.releaseClaimedAt != null && !(now - claimedAt >= CLAIM_STALE_MS);
	// A claimed hold is the expirer's (the sweeper finishes it); a live claim on a confirmed
	// booking is another cancel in flight.
	if (held && b.releaseClaimedAt != null) return fail(HOLD_EXPIRED);
	if (claimLive) return fail(INTERNAL);
	if (!canTransition(b.status, to)) return fail(CANCEL_NOT_ALLOWED);
	if (held && !(msOf(b.holdExpiresAt) > now)) return fail(HOLD_EXPIRED);

	const decision = await decide(deps, b);
	// Paid: confirmed by the payment provider, or awaiting approval after it (Pro, T131/T132).
	const paid = b.payment != null;
	if (!decision.allowed || (paid && !deps.refund)) return fail(CANCEL_NOT_ALLOWED);

	const claim = iso(now);
	const claimed = await storage.bookings.updateIf(id, {
		where: { status: b.status, releaseClaimedAt: b.releaseClaimedAt ?? null },
		set: { releaseClaimedAt: claim },
	});
	if (!claimed.applied) return fail(held ? HOLD_EXPIRED : INTERNAL);

	let mail: { kind: string; payload?: Record<string, unknown> } | undefined;
	const step = paid ? deps.refund : undefined;
	if (step) {
		const refunded = await step.run(b, decision.settings, id);
		if (!refunded.ok) {
			await storage.bookings.updateIf(id, {
				where: { status: b.status, releaseClaimedAt: claim },
				set: { releaseClaimedAt: null },
			});
			return fail(PAYMENT_FAILED);
		}
		mail = refunded.mail;
	}

	// Event and occurrence counters first: they decide whether the event sells out. A stale claim
	// is a cancel that died after claiming, maybe after releasing: releasing again could under-count
	// (oversell), so like the sweeper's `close` it releases nothing and drift repair, which does not
	// count cancelled bookings, settles the counters (an over-count meanwhile is the safe direction).
	const room = BOOKING_MAX_CALLS - (held ? CANCEL_FIXED_CALLS - 2 : CANCEL_FIXED_CALLS) - (step?.calls(b) ?? 0) - used;
	const stale = b.releaseClaimedAt != null;
	const refs = stale ? [] : countersForBooking(b).reverse().slice(0, maxOf(room, 0));
	await release(storage, refs, { sold: b.status === CONFIRMED }).catch(() => undefined);

	const moved = await storage.bookings.updateIf(id, {
		where: { status: b.status, releaseClaimedAt: claim },
		set: {
			status: to,
			cancelledAt: claim,
			// A refund step's mail means money was taken and returned. Without one a held card was released (the
			// step refuses if Stripe says otherwise) or never charged, or no step ran: there was no payment.
			...(decline && { declineReason: decline.reason, notCharged: b.totals.totalMinor > 0 && !mail }),
		},
	});
	if (!moved.applied) return fail(INTERNAL);
	// A declined buyer is told it was declined (a refund's own notice kind is for cancels, T075).
	const kind = decline ? "approval_declined" : (mail?.kind ?? "booking_cancelled");
	const notice = outboxRow(kind, id, b, claim);
	Object.assign(notice.payload, mail?.payload);
	await storage.outbox.put(`${decline ? "decline" : "cancel"}-${id}`, notice);
	return cancelled;
}

const handler =
	(
		fn: (deps: BookingDeps, raw: unknown) => Promise<unknown>,
		lookups?: LookupStep,
		refund?: (ctx: PluginContext) => RefundStep,
	): Handler =>
	async (routeCtx, ctx) =>
		fn(
			{
				storage: ctx.storage as unknown as BookingRouteStorage,
				settings: ctx.settings,
				kv: ctx.kv,
				...(lookups ? { lookups } : {}),
				...(refund ? { refund: refund(ctx) } : {}),
				now: Date.now(),
			},
			routeCtx.input,
		);

/** `public/booking` with the given lookup step (none: the Free route; a Pro build supplies one, `src/seams.ts`). */
export const bookingStatusRoute = (lookups?: LookupStep): RouteDef => publicPost(handler(bookingStatus, lookups));

export const BOOKING_ROUTE: RouteDef = bookingStatusRoute();
/** `public/booking/cancel` with the given refund step (none: the Free route; a Pro build supplies one, `src/seams.ts`). */
export const bookingCancelRoute = (refund?: (ctx: PluginContext) => RefundStep): RouteDef =>
	publicPost(handler(cancelBooking, undefined, refund));
export const BOOKING_CANCEL_ROUTE: RouteDef = bookingCancelRoute();
