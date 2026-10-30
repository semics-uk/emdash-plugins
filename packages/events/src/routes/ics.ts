import { buildCalendar, type ErrorCode, type IcsEvent, signLink, validZone, verifyLink } from "@semics-tech/shared";
import { type PluginContext, pluginResponse, type RouteHandler } from "emdash/plugin";

import { type EventInfo, type EventInfoDeps, loadEventInfo } from "../domain/event-info";
import { type LinkKv, linkSecret } from "../domain/link-secret";
import type { BookingDoc, OccurrenceDoc } from "../storage/schema";
import { routeError } from "./reply";

/**
 * `GET public/booking/ics` and `GET public/event/ics` (EV-US-3, EV-FR-08): raw `text/calendar`.
 *
 * The booking file sits behind a short-lived signed link (`signLink`/`verifyLink`, purpose
 * `events/booking-ics`, 15 minutes) that carries only the booking ref, never the access token.
 * `public/booking` hands the link's query to the token holder (`bookingCalendarQuery`). The event
 * file is public and carries no booking data; like `public/event` it answers `NOT_FOUND` for an
 * event without a config, in draft, unpublished or orphaned. Both write the event in its own time zone
 * (`DTSTART;TZID=` plus a generated VTIMEZONE).
 *
 * Bridge calls (R22): booking file = link key, booking, event config (+ occurrence) = 3 or 4;
 * event file = event config, occurrences = 2. A config without a copy of the entry's public info
 * adds a settings and an entry read (see `loadEventInfo`).
 */
export const BOOKING_ICS_PURPOSE = "events/booking-ics";
export const BOOKING_ICS_TTL_MS = 15 * 60 * 1000;
const PROD_ID = "-//semics//events//EN";
const REF_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/;
const DEFAULT_DURATION_MS = 3_600_000;
const MAX_OCCURRENCES = 50;

type Item = { id: string; data: unknown };

export interface IcsDeps extends Omit<EventInfoDeps, "storage"> {
	storage: {
		bookings: { query(o: { where: Record<string, unknown>; limit: number }): Promise<{ items: Item[] }> };
		event_configs: { get(id: string): Promise<unknown> };
		occurrences: {
			get(id: string): Promise<unknown>;
			query(o: {
				where: Record<string, unknown>;
				orderBy?: Record<string, "asc" | "desc">;
				limit: number;
			}): Promise<{ items: Item[] }>;
		};
	};
	kv: LinkKv;
	now: number;
}

export interface RawResponse {
	status: number;
	contentType: string;
	body: string;
	disposition?: string;
	cacheControl?: string;
}

const failure = (code: ErrorCode): RawResponse => {
	const { status, body } = routeError(code);
	return {
		status,
		contentType: "application/json; charset=utf-8",
		body: JSON.stringify(body),
		cacheControl: "no-store",
	};
};

/** The signed query for a booking's calendar link: 15 minutes, carries the ref only. */
export async function bookingCalendarQuery(kv: LinkKv, ref: string, now: number): Promise<string> {
	const query = await signLink({
		secret: await linkSecret(kv),
		purpose: BOOKING_ICS_PURPOSE,
		params: { ref },
		now,
		ttlMs: BOOKING_ICS_TTL_MS,
	});
	return query.toString();
}

function calendarEvent(uid: string, stamp: number, info: EventInfo, extra: Partial<IcsEvent> = {}): IcsEvent {
	const zone = validZone(info.timeZone);
	return {
		uid,
		stamp,
		start: info.startsAt,
		end: info.endsAt ?? info.startsAt + DEFAULT_DURATION_MS,
		summary: info.title,
		status: "CONFIRMED",
		...(info.venue ? { location: info.venue } : {}),
		...(zone ? { timeZone: zone } : {}),
		...extra,
	};
}

const calendar = (name: string, events: IcsEvent[]) => buildCalendar({ prodId: PROD_ID, name, events });

export async function bookingIcs(deps: IcsDeps, query: URLSearchParams): Promise<RawResponse> {
	if (query.has("token") || query.has("accessToken")) return failure("TOKEN_IN_QUERY");
	const link = await verifyLink({
		secret: await linkSecret(deps.kv),
		purpose: BOOKING_ICS_PURPOSE,
		query,
		now: deps.now,
	});
	if (!link.ok) return failure(link.error);
	const ref = link.value.ref;
	if (typeof ref !== "string" || !REF_PATTERN.test(ref)) return failure("TOKEN_INVALID");
	const { items } = await deps.storage.bookings.query({ where: { ref }, limit: 1 });
	const booking = items[0]?.data as BookingDoc | undefined;
	if (booking?.status !== "confirmed") return failure("NOT_FOUND");
	const info = await loadEventInfo(deps, booking.eventId, booking.occurrenceId);
	if (!info) return failure("NOT_FOUND");
	const body = calendar(info.title, [
		calendarEvent(`booking-${ref}@semics-events`, deps.now, info, { description: `Booking reference ${ref}` }),
	]);
	return {
		status: 200,
		contentType: "text/calendar; charset=utf-8",
		body,
		disposition: 'attachment; filename="booking.ics"',
		cacheControl: "private, no-store",
	};
}

export async function eventIcs(deps: IcsDeps, query: URLSearchParams): Promise<RawResponse> {
	const eventId = query.get("eventId") ?? "";
	if (!EVENT_ID_PATTERN.test(eventId)) return failure("BAD_REQUEST");
	const info = await loadEventInfo(deps, eventId, undefined, { publicOnly: true });
	if (!info) return failure("NOT_FOUND");
	const { items } = await deps.storage.occurrences.query({
		// The next 50 (T130): a slot schedule keeps hundreds of past dates.
		where: { eventId, status: "open", startsAt: { gte: new Date(deps.now).toISOString() } },
		orderBy: { startsAt: "asc" },
		limit: MAX_OCCURRENCES,
	});
	const duration = (info.endsAt ?? info.startsAt + DEFAULT_DURATION_MS) - info.startsAt;
	const events =
		items.length === 0
			? [calendarEvent(`event-${eventId}@semics-events`, deps.now, info)]
			: items.flatMap(({ id, data }) => {
					const start = Date.parse((data as OccurrenceDoc).startsAt);
					if (!Number.isFinite(start)) return [];
					const end = Date.parse((data as OccurrenceDoc).endsAt ?? "");
					const occ = { ...info, startsAt: start, endsAt: end > start ? end : start + duration };
					return [calendarEvent(`event-${eventId}-${id}@semics-events`, deps.now, occ)];
				});
	return {
		status: 200,
		contentType: "text/calendar; charset=utf-8",
		body: calendar(info.title, events),
		disposition: 'attachment; filename="event.ics"',
		cacheControl: "public, max-age=300",
	};
}

function toResponse(raw: RawResponse) {
	return pluginResponse({
		status: raw.status,
		headers: {
			"content-type": raw.contentType,
			"cache-control": raw.cacheControl ?? "no-store",
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
			...(raw.disposition ? { "content-disposition": raw.disposition } : {}),
		},
		body: { kind: "text", value: raw.body },
	});
}

function queryOf(request: { url?: string } | undefined): URLSearchParams {
	try {
		return request?.url ? new URL(request.url).searchParams : new URLSearchParams();
	} catch {
		return new URLSearchParams();
	}
}

const depsOf = (ctx: PluginContext): IcsDeps => ({
	storage: ctx.storage as unknown as IcsDeps["storage"],
	settings: ctx.settings,
	content: ctx.content ?? { get: async () => null },
	kv: ctx.kv,
	now: Date.now(),
});

const handler =
	(fn: (deps: IcsDeps, query: URLSearchParams) => Promise<RawResponse>): RouteHandler =>
	async (routeCtx, ctx) =>
		toResponse(await fn(depsOf(ctx), queryOf((routeCtx as unknown as { request?: { url?: string } }).request)));

export const bookingIcsHandler = handler(bookingIcs);
export const eventIcsHandler = handler(eventIcs);
