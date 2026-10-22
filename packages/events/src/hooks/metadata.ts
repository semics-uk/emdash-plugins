import { fromMinor } from "@semics-tech/shared";
import type { PageMetadataEvent, PluginContext } from "emdash/plugin";

import { mappingOf } from "../domain/event-info";
import type { EventConfigDoc, TicketTypeDoc } from "../storage/schema";

/**
 * `page:metadata`: schema.org `Event` JSON-LD for an entry of the events collection (EV-FR-10).
 *
 * Public data only: name, dates (with the event's UTC offset), venue, status and one `Offer` per
 * visible ticket type with its price and an availability word. Counters, capacities, hidden types
 * and booking data never appear. A draft, unpublished or orphaned event, another collection and
 * any page without an entry contribute nothing.
 *
 * Bridge calls (R22, target 8): settings (the collection mapping), the event config and its ticket
 * types = 3. The host escapes `<`, `>` and the line separators when it prints the script tag; this
 * module also keeps `<` out of every string, so a title cannot close the tag whatever renders it.
 */
type Item = { id: string; data: unknown };

export interface MetadataDeps {
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	storage: {
		event_configs: { get(id: string): Promise<unknown> };
		ticket_types: { query(o: { where: Record<string, unknown>; limit: number }): Promise<{ items: Item[] }> };
	};
	now: number;
}

const SCHEMA = "https://schema.org/";
const TYPE_PAGE = 100;

/** `<` becomes the full-width sign: JSON-LD is read by machines and a raw `</script` is the one thing to rule out. */
const safe = (value: string) => value.replaceAll("<", "＜");

const left = (capacity: number, reserved: number) => Math.max(0, capacity - reserved);

/** The offset of `timeZone` at `ms` as `+01:00`, or `Z` when the zone is unknown or UTC. */
export function offsetOf(ms: number, timeZone: string | null | undefined): string {
	if (!timeZone) return "Z";
	try {
		const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
			.formatToParts(new Date(ms))
			.find((p) => p.type === "timeZoneName")?.value;
		if (part === "GMT") return "+00:00";
		const match = /^GMT([+-]\d{2}:\d{2})$/.exec(part ?? "");
		return match ? (match[1] as string) : "Z";
	} catch {
		return "Z";
	}
}

/** ISO local date-time with the zone's offset: `2099-07-14T20:00:00+01:00`. */
export function withOffset(iso: string, timeZone: string | null | undefined): string | null {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return null;
	const offset = offsetOf(ms, timeZone);
	if (offset === "Z") return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
	const sign = offset.startsWith("-") ? -1 : 1;
	const [h, m] = offset.slice(1).split(":").map(Number) as [number, number];
	const local = new Date(ms + sign * (h * 60 + m) * 60_000).toISOString();
	return `${local.slice(0, 19)}${offset}`;
}

function availability(c: EventConfigDoc, t: TicketTypeDoc, now: number): string {
	const end = Date.parse(c.salesEnd ?? "");
	const start = Date.parse(c.salesStart ?? "");
	if (c.status !== "on_sale" || (Number.isFinite(end) && end <= now)) return `${SCHEMA}Discontinued`;
	if (left(t.capacity, t.reserved) === 0 || left(c.capacity, c.reserved) === 0) return `${SCHEMA}SoldOut`;
	if (Number.isFinite(start) && start > now) return `${SCHEMA}PreOrder`;
	return `${SCHEMA}InStock`;
}

/** The JSON-LD graph, or `null` when the event is not public. */
export async function eventJsonLd(
	deps: MetadataDeps,
	event: PageMetadataEvent,
): Promise<Record<string, unknown> | null> {
	const content = event.page.content;
	if (!content) return null;
	const mapping = mappingOf(await deps.settings.list());
	if (content.collection !== mapping.collection) return null;
	const config = (await deps.storage.event_configs.get(content.id)) as EventConfigDoc | null;
	if (!config?.info || config.orphaned || config.unpublished || config.status === "draft") return null;
	const { info } = config;
	const startDate = withOffset(info.startsAt, info.timezone);
	if (!startDate) return null;
	const endDate = info.endsAt ? withOffset(info.endsAt, info.timezone) : null;

	const { items } = await deps.storage.ticket_types.query({ where: { eventId: content.id }, limit: TYPE_PAGE });
	const url = safe(event.page.canonical ?? event.page.url);
	const offers = items
		.map((i) => i.data as TicketTypeDoc)
		.filter((t) => !t.hidden)
		.sort((a, b) => a.sort - b.sort || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
		.map((t) => ({
			"@type": "Offer",
			name: safe(t.name),
			price: fromMinor(t.priceMinor, config.currency),
			priceCurrency: config.currency,
			availability: availability(config, t, deps.now),
			url,
		}));
	return {
		"@context": "https://schema.org",
		"@type": "Event",
		name: safe(info.title),
		url,
		startDate,
		...(endDate ? { endDate } : {}),
		eventStatus: `${SCHEMA}${config.status === "cancelled" ? "EventCancelled" : "EventScheduled"}`,
		eventAttendanceMode: `${SCHEMA}OfflineEventAttendanceMode`,
		...(info.venue ? { location: { "@type": "Place", name: safe(info.venue) } } : {}),
		...(offers.length > 0 ? { offers } : {}),
	};
}

export const pageMetadata = async (event: PageMetadataEvent, ctx: PluginContext) => {
	const graph = await eventJsonLd(
		{ settings: ctx.settings, storage: ctx.storage as unknown as MetadataDeps["storage"], now: Date.now() },
		event,
	);
	return graph ? { kind: "jsonld" as const, id: "semics-events", graph } : null;
};
