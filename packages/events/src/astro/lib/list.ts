// The UI ships as source, so it cannot import the private @semics-tech/shared (scripts/ui-imports.test.mjs).
function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone });
		return true;
	} catch {
		return false;
	}
}

function formatInZone(utcMs: number, timeZone: string, locale: string, options: Intl.DateTimeFormatOptions): string {
	return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(utcMs));
}

import { formatMoney } from "./widget";

/** One row of `public/events` (T046): public fields only, never counters. */
export interface PublicEventSummary {
	eventId: string;
	title: string;
	status: "on_sale" | "paused" | "closed" | "cancelled";
	startsAt: string;
	endsAt?: string | null;
	timezone?: string | null;
	venue?: string | null;
	currency: string;
	priceFromMinor?: number;
	/** Seats left (never negative). */
	available: number;
}

export interface CardView {
	eventId: string;
	title: string;
	/** Start in the event's own zone, with the zone's short name. */
	when: string;
	/** The start as an ISO instant, for `<time datetime>`. */
	datetime: string;
	venue: string | null;
	price: string | null;
	/** "Sold out", "Cancelled", ... or `null` when the event can be booked. */
	badge: string | null;
}

const WHEN: Intl.DateTimeFormatOptions = {
	weekday: "short",
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
	timeZoneName: "short",
};

const BADGES = {
	cancelled: "Cancelled",
	closed: "Sales closed",
	paused: "Sales paused",
} as const;

/** The start in the event's own zone; a missing or unknown zone shows UTC rather than failing. */
export function eventWhen(startsAt: string, timezone: string | null | undefined, locale: string): string {
	const zone = timezone && isValidTimeZone(timezone) ? timezone : "UTC";
	return formatInZone(Date.parse(startsAt), zone, locale, WHEN);
}

export function cardView(event: PublicEventSummary, locale: string): CardView {
	const badge = event.status !== "on_sale" ? BADGES[event.status] : event.available === 0 ? "Sold out" : null;
	let price: string | null = null;
	if (event.priceFromMinor !== undefined) {
		price = event.priceFromMinor === 0 ? "Free" : `From ${formatMoney(event.priceFromMinor, event.currency, locale)}`;
	}
	return {
		eventId: event.eventId,
		title: event.title,
		when: eventWhen(event.startsAt, event.timezone, locale),
		datetime: event.startsAt,
		venue: event.venue ?? null,
		price,
		badge,
	};
}

/** The first `limit` events (as `public/events` sorted them: soonest first) as cards. */
export function listView(events: PublicEventSummary[], options: { limit: number; locale: string }): CardView[] {
	return events.slice(0, Math.max(0, options.limit)).map((event) => cardView(event, options.locale));
}
