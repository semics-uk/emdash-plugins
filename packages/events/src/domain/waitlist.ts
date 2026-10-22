/**
 * Waitlist offers (EV-FR-16, EV-US-6, T081). Pure: what an entry would be offered from the event
 * config alone, and which counters must be read first. Time is passed in.
 *
 * An offer is an ordinary held booking in the waitlister's name, reserved through the same inventory
 * guards as checkout, so an offer, a checkout and another offer racing for one seat cannot all win.
 * The config's event counter is exact; the catalog has capacities but no counters, and a ticket type's
 * or date's `reserved` can never exceed the event's. So a step is certain to fit when the event's
 * `reserved` plus the seats still fits that step's capacity; otherwise its counter is read first (a
 * guard miss after that is only a race, and is undone).
 */
import type { EventConfigDoc, WaitlistDoc } from "../storage/schema";
import { type CheckoutPlan, planCheckout } from "./checkout";

/** How long an offer holds the seats for the waitlister: the claim link's life. */
export const OFFER_HOURS = 24;

/** True when the event may take a waitlist offer now: on sale, live, waitlist on, a seat left. */
export function offerable(c: EventConfigDoc): boolean {
	return c.waitlistEnabled && c.status === "on_sale" && !c.orphaned && !c.unpublished && c.capacity > c.reserved;
}

export interface OfferPlan {
	plan: CheckoutPlan;
	/** Counted documents whose room the config cannot vouch for: read before offering. */
	reads: Array<{ collection: "ticket_types" | "occurrences"; id: string; qty: number }>;
}

/**
 * The order an entry would place now: its ticket type, else the listed type most likely to have
 * room, cheapest first. `null` when nothing fits (sold out, closed, no such type or date).
 */
export function planOffer(eventId: string, c: EventConfigDoc, e: WaitlistDoc, now: number): OfferPlan | null {
	const sure = (capacity: number) => c.reserved + e.qty <= capacity;
	const types = Object.entries(c.catalog?.ticketTypes ?? {})
		.filter(([id, t]) => (e.ticketTypeId ? id === e.ticketTypeId : !t.hidden))
		.sort(([, x], [, y]) => Number(sure(y.capacity)) - Number(sure(x.capacity)) || x.priceMinor - y.priceMinor);
	for (const [ticketTypeId] of types) {
		const planned = planCheckout(
			eventId,
			c,
			{
				eventId,
				occurrenceId: e.occurrenceId,
				lines: [{ ticketTypeId, qty: e.qty }],
				buyer: { name: e.name, email: e.email },
				idempotencyKey: "",
			},
			now,
			{ maxSteps: 3 },
		);
		if (!planned.ok) continue;
		let reads = planned.value.steps.flatMap((s) =>
			s.collection === "event_configs" || sure(s.capacity) ? [] : [{ collection: s.collection, id: s.id, qty: s.qty }],
		);
		// Within the tick's budget: with a date (three steps) read at most one counter, the date's.
		if (reads.length + planned.value.steps.length > 4) reads = reads.filter((r) => r.collection === "occurrences");
		return { plan: planned.value, reads };
	}
	return null;
}
