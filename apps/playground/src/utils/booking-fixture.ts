// The booking widget's ticket data for e2e events, from seed/events-fixture.json (the same file
// e2e/harness/fixtures.mjs writes into the core's storage). Stands in for `public/event` until
// T046 implements that route; then the event page drops `data` and the widget loads it itself.
import fixture from "../../seed/events-fixture.json";

interface FixtureEvent {
	currency: string;
	ticketTypes: Record<string, { name: string; priceMinor: number; capacity: number; maxPerOrder?: number }>;
}

export function bookingFixture(slug: string, eventId: string, timezone?: string) {
	const event = (fixture as Record<string, FixtureEvent>)[slug];
	if (!event) return undefined;
	return {
		eventId,
		status: "on_sale" as const,
		currency: event.currency,
		...(timezone ? { timezone } : {}),
		ticketTypes: Object.entries(event.ticketTypes).map(([id, t]) => ({
			id,
			name: t.name,
			priceMinor: t.priceMinor,
			available: t.capacity,
			maxPerOrder: t.maxPerOrder ?? null,
		})),
	};
}
