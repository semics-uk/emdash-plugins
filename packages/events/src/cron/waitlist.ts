/**
 * The `waitlist` cron task (EV-FR-16, EV-US-6, T081): offers freed seats to the waitlist, one offer a
 * minute. Seats come free on cancel, expiry and refund; rather than adding calls to those paths, each
 * tick compares availability: one query of the on-sale event configs (their event counter is exact),
 * then one query of the waiting entries of the events with a seat left, in join order (the storage's
 * default order). The earliest entry that fits gets the offer:
 *
 * 1. claim the entry (`waiting` → `offered`, guarded, so overlapping ticks never offer it twice);
 * 2. write a held booking in the waitlister's name, holding until the offer ends (`OFFER_HOURS`), as
 *    the inventory ordering contract asks (booking first, so drift repair never under-counts);
 * 3. reserve its seats with the checkout guards; a miss (another booking won the seat) puts the entry
 *    back in its place and closes the booking;
 * 4. queue `offer-<bookingId>` in the outbox (ids only; the claim code is minted at send time).
 *
 * An unclaimed offer is an ordinary hold: the sweeper expires it and releases the seats, and the next
 * tick offers them to the next entry. Every fifth minute a tick without an offer marks lapsed offers
 * `expired`.
 *
 * Budget (R22: limit 10, target 8): configs query, entries query, at most one counter read (when the
 * config cannot vouch for a ticket type's or date's room), claim, booking, 2-3 guarded reserves,
 * outbox. An event without dates is at most 8; with dates 9 (10 when the seat is lost to a race). An
 * idle site costs one call a minute.
 */
import { generateToken, hashToken } from "@semics-tech/shared";

import { bookingKeys, type CheckoutPlan } from "../domain/checkout";
import { DEFAULT_HOLD_SETTINGS, startHold } from "../domain/holds";
import { type Counter, type CounterStorage, reserve } from "../domain/inventory";
import { iso } from "../domain/time";
import { OFFER_HOURS, offerable, planOffer } from "../domain/waitlist";
import { newBooking } from "../routes/checkout-reserve";
import type { BookingDoc, EventConfigDoc, OutboxDoc, WaitlistDoc } from "../storage/schema";

export const WAITLIST_TASK = "waitlist";
export const WAITLIST_SCHEDULE = "* * * * *";
const MAX_CALLS = 10;
const TARGET_CALLS = 8;

type Where = Record<string, unknown>;
type Query = (o: { where: Where; limit: number }) => Promise<{ items: Array<{ id: string; data: unknown }> }>;
type UpdateIf = (id: string, o: { where: Where; set: Where }) => Promise<{ applied: boolean }>;

export type WaitlistStorage = CounterStorage & {
	event_configs: { query: Query };
	ticket_types: { get(id: string): Promise<unknown> };
	occurrences: { get(id: string): Promise<unknown> };
	waitlist: { query: Query; updateIf: UpdateIf };
	bookings: { put(id: string, data: BookingDoc): Promise<unknown>; updateIf: UpdateIf };
	outbox: { put(id: string, data: OutboxDoc): Promise<unknown> };
};

const MINUTES = OFFER_HOURS * 60;

/** Offer an entry its seats: `entry` when another tick took the entry, `seat` when another booking won the seat. */
async function offer(
	st: WaitlistStorage,
	entryId: string,
	e: WaitlistDoc,
	c: EventConfigDoc,
	plan: CheckoutPlan,
	now: number,
	room: number,
): Promise<"ok" | "entry" | "seat"> {
	const { id, ref } = await bookingKeys(`waitlist:${entryId}:${now}`);
	// Extensions after a claim may run past the offer by the usual ceiling, so a late claim can still pay.
	const hold = startHold(
		now,
		{ paid: false },
		{ freeMinutes: MINUTES, paidMinutes: MINUTES, ceilingMinutes: MINUTES + DEFAULT_HOLD_SETTINGS.ceilingMinutes },
	);
	const claimed = await st.waitlist.updateIf(entryId, {
		where: { status: "waiting" },
		set: { status: "offered", offerExpiresAt: hold.holdExpiresAt, bookingId: id },
	});
	if (!claimed.applied) return "entry";
	await st.bookings.put(
		id,
		newBooking(
			{ ref, eventId: e.eventId, occurrenceId: e.occurrenceId || undefined, status: "held" },
			hold,
			e,
			plan,
			c,
			now,
			// Nobody holds a token yet: the claim swaps the emailed code for one.
			await hashToken(generateToken()),
			{ waitlistId: entryId },
		),
	);
	// Keep two calls to undo a lost race; compensation beyond that is left to drift repair.
	const reserved = await reserve(st, plan.steps, { maxCalls: room - 4 });
	if (reserved.ok) {
		await st.outbox.put(`offer-${id}`, {
			kind: "waitlist_offer",
			to: e.email,
			payload: { bookingId: id },
			attempts: 0,
			nextAttemptAt: iso(now),
			status: "pending",
		});
		return "ok";
	}
	const quiet = () => ({ applied: false });
	await st.waitlist
		.updateIf(entryId, {
			where: { status: "offered", bookingId: id },
			set: { status: "waiting", offerExpiresAt: null, bookingId: null },
		})
		.catch(quiet);
	// All seats given back: closed now. Otherwise a dead draft, which the sweeper closes and repairs.
	await st.bookings
		.updateIf(id, {
			where: { status: "held", releaseClaimedAt: null },
			set:
				reserved.error.uncompensated.length > 0
					? { status: "draft", holdExpiresAt: iso(now) }
					: { status: "expired", expiredAt: iso(now) },
		})
		.catch(quiet);
	return "seat";
}

/** One tick. Returns the bridge calls it made (at most 10) and what it did. */
export async function waitlistTick({ storage: st, now }: { storage: WaitlistStorage; now: number }) {
	const configs = new Map<string, EventConfigDoc>();
	for (const { id, data } of (await st.event_configs.query({ where: { status: "on_sale" }, limit: 100 })).items) {
		if (offerable(data as EventConfigDoc)) configs.set(id, data as EventConfigDoc);
	}
	let calls = 1;
	let offered: string | undefined;
	if (configs.size > 0) {
		const { items } = await st.waitlist.query({
			where: { eventId: { in: [...configs.keys()] }, status: "waiting" },
			limit: 50,
		});
		calls++;
		const counters = new Map<string, Counter | null>();
		const byJoin = (x: { data: unknown }) => (x.data as WaitlistDoc).createdAt;
		for (const { id, data } of items.sort((a, b) => (byJoin(a) < byJoin(b) ? -1 : 1))) {
			const e = data as WaitlistDoc;
			const c = configs.get(e.eventId) as EventConfigDoc;
			const o = planOffer(e.eventId, c, e, now);
			if (!o) continue;
			const unread = o.reads.filter((r) => !counters.has(`${r.collection}/${r.id}`));
			if (calls + unread.length + o.plan.steps.length + 4 > MAX_CALLS) break;
			for (const r of unread) {
				counters.set(`${r.collection}/${r.id}`, (await st[r.collection].get(r.id)) as Counter | null);
				calls++;
			}
			const full = o.reads.some((r) => {
				const d = counters.get(`${r.collection}/${r.id}`);
				return !d || (d.reserved ?? 0) + r.qty > d.capacity;
			});
			if (full) continue;
			const outcome = await offer(st, id, e, c, o.plan, now, MAX_CALLS - calls);
			if (outcome === "ok") {
				offered = id;
				calls += 3 + o.plan.steps.length;
				break;
			}
			// A lost entry cost one call; a lost seat may have used the rest of the budget.
			if (outcome === "seat") return { calls: MAX_CALLS, offered, expired: 0 };
			calls++;
		}
	}
	let expired = 0;
	// Every fifth minute, a tick without an offer marks lapsed offers (so an idle minute is one call).
	if (!offered && calls + 2 <= TARGET_CALLS && Math.floor(now / 60_000) % 5 === 0) {
		const { items } = await st.waitlist.query({
			where: { status: "offered", offerExpiresAt: { lt: iso(now) } },
			limit: TARGET_CALLS - calls - 1,
		});
		calls++;
		for (const { id, data } of items) {
			const at = (data as WaitlistDoc).offerExpiresAt;
			const r = await st.waitlist.updateIf(id, {
				where: { status: "offered", offerExpiresAt: at },
				set: { status: "expired" },
			});
			calls++;
			if (r.applied) expired++;
		}
	}
	return { calls, offered, expired };
}

/** The `cron` hook's share; true when `event` was ours. */
export async function runWaitlistJob(event: { name: string }, ctx: { storage: unknown }, now = Date.now()) {
	if (event.name !== WAITLIST_TASK) return false;
	await waitlistTick({ storage: ctx.storage as WaitlistStorage, now });
	return true;
}
