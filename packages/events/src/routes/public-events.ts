import { toRouteError } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import type { EventConfigDoc, OccurrenceDoc, TicketTypeDoc } from "../storage/schema";

/**
 * `GET public/events` (the listing, cached 60 s) and `GET public/event?eventId=` (one event with
 * its ticket types and dates), EV-FR-03. Both answer only from what is public:
 *
 * - An event is listed once its config leaves `draft` and while it is not orphaned (its entry was
 *   deleted). A draft or unknown event is the same `NOT_FOUND`.
 * - Counters never leave the core. The answer carries `available` (seats left, never negative),
 *   which is the smaller of the type's, the date's and the event's own remaining seats; no
 *   `reserved`, `sold`, capacity, hidden ticket type, question, waiver or booking data.
 * - The title, times, zone and venue come from the copy of the entry on the config
 *   (`EventConfigDoc.info`, T046), so a listing is one `event_configs.query`. A config without a
 *   copy (its entry is missing or has no usable start) is not listed.
 *
 * Bridge calls (R22, target 8): listing = 1. One event = config, ticket types, occurrences (only
 * for a recurring event), settings (the public Turnstile site key) = 4.
 *
 * `public/event` answers in the `PublicEvent` shape of `src/astro/lib/widget.ts` (T055).
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;
type Item = { id: string; data: unknown };

export const EVENTS_LIST_CACHE = "public, max-age=60, stale-while-revalidate=300";
const EVENT_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/;
const LISTED_STATUSES = ["on_sale", "paused", "closed", "cancelled"];
const MAX_EVENTS = 100;
const MAX_OCCURRENCES = 50;

export interface PublicEventsStorage {
	event_configs: {
		get(id: string): Promise<unknown>;
		query(o: { where: Record<string, unknown>; limit: number }): Promise<{ items: Item[] }>;
	};
	ticket_types: { query(o: { where: Record<string, unknown>; limit: number }): Promise<{ items: Item[] }> };
	occurrences: {
		query(o: {
			where: Record<string, unknown>;
			orderBy: Record<string, "asc" | "desc">;
			limit: number;
		}): Promise<{ items: Item[] }>;
	};
}

export interface PublicEventsDeps {
	storage: PublicEventsStorage;
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	now: number;
}

const left = (capacity: number, reserved: number) => Math.max(0, capacity - reserved);
const notFound = () => toRouteError("NOT_FOUND").body;
const iso = (ms: number) => new Date(ms).toISOString();

/** `closed` once the sales end has passed, else the stored status. */
const statusOf = (c: EventConfigDoc, now: number): EventConfigDoc["status"] => {
	const end = Date.parse(c.salesEnd ?? "");
	return c.status === "on_sale" && Number.isFinite(end) && end <= now ? "closed" : c.status;
};

/** The first start that has not passed: an upcoming date of a recurring event, else the event's own. */
function nextStart(c: EventConfigDoc, now: number): { startsAt: string; endsAt: string | null } | null {
	const info = c.info;
	if (!info) return null;
	const dates = Object.values(c.catalog?.occurrences ?? {});
	if (dates.length > 0) {
		const upcoming = dates
			.filter((o) => o.status === "open")
			.map((o) => Date.parse(o.startsAt))
			.filter((ms) => Number.isFinite(ms) && ms >= now)
			.sort((a, b) => a - b);
		return upcoming[0] === undefined ? null : { startsAt: iso(upcoming[0]), endsAt: null };
	}
	const end = Date.parse(info.endsAt ?? info.startsAt);
	return end >= now ? { startsAt: info.startsAt, endsAt: info.endsAt } : null;
}

export async function listEvents(deps: PublicEventsDeps): Promise<unknown> {
	const { items } = await deps.storage.event_configs.query({
		where: { status: { in: LISTED_STATUSES } },
		limit: MAX_EVENTS,
	});
	const events = items.flatMap(({ id, data }) => {
		const c = data as EventConfigDoc;
		const when = c.orphaned || c.unpublished ? null : nextStart(c, deps.now);
		if (!c.info || !when) return [];
		const prices = Object.values(c.catalog?.ticketTypes ?? {})
			.filter((t) => !t.hidden)
			.map((t) => t.priceMinor);
		return [
			{
				eventId: id,
				title: c.info.title,
				status: statusOf(c, deps.now),
				...when,
				timezone: c.info.timezone,
				venue: c.info.venue,
				currency: c.currency,
				...(prices.length > 0 ? { priceFromMinor: Math.min(...prices) } : {}),
				available: left(c.capacity, c.reserved),
				// The entry's slug, so a card can link to the event's page (T056).
				...(c.info.slug ? { slug: c.info.slug } : {}),
			},
		];
	});
	events.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
	return { ok: true, events };
}

export async function getEvent(deps: PublicEventsDeps, raw: unknown): Promise<unknown> {
	const eventId = (raw as { eventId?: unknown } | null | undefined)?.eventId;
	if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) return notFound();
	const { storage } = deps;
	const config = (await storage.event_configs.get(eventId)) as EventConfigDoc | null;
	if (!config || config.orphaned || config.unpublished || config.status === "draft") return notFound();

	const recurring = Object.keys(config.catalog?.occurrences ?? {}).length > 0;
	const [types, dates, settings] = await Promise.all([
		storage.ticket_types.query({ where: { eventId }, limit: 100 }),
		recurring
			? storage.occurrences.query({
					where: { eventId, status: "open" },
					orderBy: { startsAt: "asc" },
					limit: MAX_OCCURRENCES,
				})
			: null,
		deps.settings.list(),
	]);
	const eventLeft = left(config.capacity, config.reserved);
	const ticketTypes = types.items
		.map((i) => ({ id: i.id, t: i.data as TicketTypeDoc }))
		.filter(({ t }) => !t.hidden)
		.sort((a, b) => a.t.sort - b.t.sort || (a.t.name < b.t.name ? -1 : a.t.name > b.t.name ? 1 : 0))
		.map(({ id, t }) => ({
			id,
			name: t.name,
			priceMinor: t.priceMinor,
			available: Math.min(left(t.capacity, t.reserved), eventLeft),
			minPerOrder: t.minPerOrder ?? null,
			maxPerOrder: t.maxPerOrder ?? null,
		}));
	const occurrences = dates?.items
		.map((i) => ({ id: i.id, o: i.data as OccurrenceDoc }))
		.filter(({ o }) => Date.parse(o.startsAt) >= deps.now)
		.map(({ id, o }) => ({
			id,
			startsAt: o.startsAt,
			endsAt: o.endsAt ?? null,
			available: Math.min(left(o.capacity, o.reserved), eventLeft),
		}));
	const siteKey = settings.find((s) => s.key === "turnstileSiteKey")?.value;
	const info = config.info;
	return {
		ok: true,
		eventId,
		...(info ? { title: info.title, startsAt: info.startsAt, endsAt: info.endsAt, venue: info.venue } : {}),
		status: statusOf(config, deps.now),
		currency: config.currency,
		...(info?.timezone ? { timezone: info.timezone } : {}),
		ticketTypes,
		...(occurrences ? { occurrences } : {}),
		...(typeof siteKey === "string" && siteKey.trim() !== "" ? { turnstileSiteKey: siteKey.trim() } : {}),
	};
}

const depsOf = (ctx: PluginContext): PublicEventsDeps => ({
	storage: ctx.storage as unknown as PublicEventsStorage,
	settings: ctx.settings,
	now: Date.now(),
});

export const EVENTS_LIST_ROUTE: RouteDef = {
	methods: ["GET"],
	public: true,
	cacheControl: EVENTS_LIST_CACHE,
	handler: (async (_routeCtx, ctx) => listEvents(depsOf(ctx))) as Handler,
};

export const EVENT_ROUTE: RouteDef = {
	methods: ["GET"],
	public: true,
	handler: (async (routeCtx, ctx) => getEvent(depsOf(ctx), routeCtx.input)) as Handler,
};
