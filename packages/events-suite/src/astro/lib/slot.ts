/**
 * What the waiver page says about the booking it is signing for (T148): the event's title and the
 * booked date and time, in the event's own zone and in the format of the booking widget's date list.
 * Read through Events' public routes (`public/booking`, then `public/event`), so Events gains no code.
 * Only the event's own public details: no personal data. Any failure shows nothing extra.
 */
import { callPublicRoute, type PublicRouteContext } from "@semics-tech/emdash-events/astro/lib/call";
import { bookingCookieName } from "@semics-tech/emdash-events/astro/lib/checkout-form";

import { retryCookieName, type SuiteIds } from "./flow.ts";

export interface WaiverSlot {
	title?: string;
	/** "Wednesday 4 November 2026 at 13:30" in the event's zone; absent when the date is unknown. */
	when?: string;
	/** The ISO start, for a `<time datetime>`. */
	startsAt?: string;
}

interface BookingAnswer {
	eventId?: string;
	occurrenceId?: string;
}

interface EventAnswer {
	title?: string;
	timezone?: string;
	startsAt?: string;
	occurrences?: Array<{ id: string; startsAt: string }>;
}

/** The widget's date format (full date, short time) in `zone`; UTC when the zone is unknown. */
export function formatSlot(iso: string, zone: string | undefined, locale = "en-GB"): string {
	const options = { dateStyle: "full", timeStyle: "short" } as const;
	const date = new Date(iso);
	try {
		return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone ?? "UTC" }).format(date);
	} catch {
		return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
	}
}

export async function waiverSlot(
	ctx: { locals: PublicRouteContext["locals"]; url: URL; request: Request; cookie(name: string): string | undefined },
	ids: SuiteIds,
	ref: string,
	locale?: string,
): Promise<WaiverSlot | undefined> {
	const accessToken = ctx.cookie(retryCookieName(ref)) || ctx.cookie(bookingCookieName(ref));
	if (!accessToken) return undefined;
	const call = { locals: ctx.locals, url: ctx.url, request: ctx.request };
	try {
		const booking = await callPublicRoute<BookingAnswer>(call, {
			method: "POST",
			path: "public/booking",
			pluginId: ids.eventsPluginId,
			body: { bookingRef: ref, accessToken },
		});
		if (!booking.ok || !booking.data.eventId) return undefined;
		const event = await callPublicRoute<EventAnswer>(call, {
			path: "public/event",
			pluginId: ids.eventsPluginId,
			body: { eventId: booking.data.eventId },
		});
		if (!event.ok) return undefined;
		const { occurrenceId } = booking.data;
		const startsAt = occurrenceId
			? event.data.occurrences?.find((o) => o.id === occurrenceId)?.startsAt
			: event.data.startsAt;
		const slot: WaiverSlot = {
			...(event.data.title ? { title: event.data.title } : {}),
			...(startsAt && Number.isFinite(Date.parse(startsAt))
				? { startsAt, when: formatSlot(startsAt, event.data.timezone, locale) }
				: {}),
		};
		return slot.title || slot.when ? slot : undefined;
	} catch {
		return undefined;
	}
}
