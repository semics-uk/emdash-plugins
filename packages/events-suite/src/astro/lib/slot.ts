/**
 * What the waiver page says about the booking it is signing for (T148): the event's title and the
 * booked date and time, in the event's own zone and in the format of the booking widget's date list.
 * Read through Events' public routes: `public/booking` carries the event's public info with the
 * booked date's start (T151), so a booking made while on sale keeps its line after the event moves
 * to draft or paused, when `public/event` answers nothing. An Events build without it falls back to
 * `public/event`. Only the event's own public details: no personal data. Any failure shows nothing extra.
 */
import { callPublicRoute, type PublicRouteContext } from "@semics-tech/emdash-events/astro/lib/call";

import { type BookingAnswer, readBooking, type SuiteIds } from "./flow.ts";

export interface WaiverSlot {
	title?: string;
	/** "Wednesday 4 November 2026 at 13:30" in the event's zone; absent when the date is unknown. */
	when?: string;
	/** The ISO start, for a `<time datetime>`. */
	startsAt?: string;
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

/** The booked start and the event's title and zone, from the booking or else from `public/event`. */
async function slotInfo(
	ctx: PublicRouteContext,
	ids: SuiteIds,
	booking: BookingAnswer,
): Promise<{ title?: string; startsAt?: string; timezone?: string } | undefined> {
	const own = booking.event;
	if (own) {
		return {
			...(own.title ? { title: own.title } : {}),
			...(own.startsAt ? { startsAt: own.startsAt } : {}),
			...(own.timezone ? { timezone: own.timezone } : {}),
		};
	}
	if (!booking.eventId) return undefined;
	const event = await callPublicRoute<EventAnswer>(ctx, {
		path: "public/event",
		pluginId: ids.eventsPluginId,
		body: { eventId: booking.eventId },
	});
	if (!event.ok) return undefined;
	const { occurrenceId } = booking;
	const startsAt = occurrenceId
		? event.data.occurrences?.find((o) => o.id === occurrenceId)?.startsAt
		: event.data.startsAt;
	return {
		...(event.data.title ? { title: event.data.title } : {}),
		...(startsAt ? { startsAt } : {}),
		...(event.data.timezone ? { timezone: event.data.timezone } : {}),
	};
}

/**
 * The slot line for booking `ref`. `booking` is the `public/booking` answer the page already read
 * (the flow's render outcome carries it); without it the booking is read here.
 */
export async function waiverSlot(
	ctx: { locals: PublicRouteContext["locals"]; url: URL; request: Request; cookie(name: string): string | undefined },
	ids: SuiteIds,
	ref: string,
	locale?: string,
	booking?: BookingAnswer,
): Promise<WaiverSlot | undefined> {
	const call = { locals: ctx.locals, url: ctx.url, request: ctx.request };
	try {
		const answer = booking ?? (await readBooking(ctx, ids, ref));
		const info = answer && (await slotInfo(call, ids, answer));
		if (!info) return undefined;
		const { startsAt } = info;
		const slot: WaiverSlot = {
			...(info.title ? { title: info.title } : {}),
			...(startsAt && Number.isFinite(Date.parse(startsAt))
				? { startsAt, when: formatSlot(startsAt, info.timezone, locale) }
				: {}),
		};
		return slot.title || slot.when ? slot : undefined;
	} catch {
		return undefined;
	}
}
