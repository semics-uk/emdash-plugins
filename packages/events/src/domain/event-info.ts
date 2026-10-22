import type { EventConfigDoc, EventInfoDoc, OccurrenceDoc } from "../storage/schema";

/**
 * What emails, calendar files and the public event routes need to know about an event: its title,
 * times, zone and venue. They live in the site's content entry, in the collection and fields the
 * site owner maps in settings (`eventsCollection`, `fieldStartsAt`, `fieldEndsAt`, `fieldTimezone`,
 * `fieldVenue`; the site's own fields are snake_case, so the defaults are `starts_at` and so on).
 *
 * This is the one place that reads the mapping. The result is denormalised onto the event config
 * (`EventConfigDoc.info`) when the entry is saved (`content:afterSave`) and when `config/save`
 * creates a config, so a reader needs one document: `loadEventInfo` takes it from the config and
 * falls back to the entry only for a config that has no copy yet.
 */
export interface EventInfo {
	title: string;
	startsAt: number;
	endsAt?: number;
	timeZone?: string;
	venue?: string;
}

export interface EventMapping {
	collection: string;
	startsAt: string;
	endsAt: string;
	timezone: string;
	venue: string;
}

export interface EventInfoDeps {
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	content: {
		get(collection: string, id: string): Promise<{ data: Record<string, unknown>; slug?: string | null } | null>;
	};
	storage: {
		occurrences: { get(id: string): Promise<unknown> };
		event_configs: { get(id: string): Promise<unknown> };
	};
}

const DEFAULTS: EventMapping = {
	collection: "events",
	startsAt: "starts_at",
	endsAt: "ends_at",
	timezone: "timezone",
	venue: "venue",
};

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const instant = (v: unknown): number | undefined => {
	const ms = typeof v === "string" ? Date.parse(v) : Number.NaN;
	return Number.isFinite(ms) ? ms : undefined;
};
const iso = (ms: number) => new Date(ms).toISOString();

/** The mapping from a settings listing; an unset (or blank) setting means its default. */
export function mappingOf(entries: ReadonlyArray<{ key: string; value: unknown }>): EventMapping {
	const value = (key: string, fallback: string) => text(entries.find((e) => e.key === key)?.value) ?? fallback;
	return {
		collection: value("eventsCollection", DEFAULTS.collection),
		startsAt: value("fieldStartsAt", DEFAULTS.startsAt),
		endsAt: value("fieldEndsAt", DEFAULTS.endsAt),
		timezone: value("fieldTimezone", DEFAULTS.timezone),
		venue: value("fieldVenue", DEFAULTS.venue),
	};
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The public info of an entry, read through the mapping; `null` without a usable start. Takes a
 * content item (`{ id, slug, data: { ...fields } }`, what `ctx.content.get` returns and what EmDash
 * passes to the content hooks) or a flat record of the fields. The entry's slug is kept so the
 * listing can link to the event's page (T056).
 */
export function infoOfEntry(entry: Record<string, unknown>, mapping: EventMapping): EventInfoDoc | null {
	const data = isRecord(entry.data) ? entry.data : entry;
	const startsAt = instant(data[mapping.startsAt]);
	if (startsAt === undefined) return null;
	const endsAt = instant(data[mapping.endsAt]);
	const slug = text(entry.slug) ?? text(data.slug);
	return {
		title: text(data.title) ?? "Event",
		startsAt: iso(startsAt),
		endsAt: endsAt !== undefined && endsAt > startsAt ? iso(endsAt) : null,
		timezone: text(data[mapping.timezone]) ?? null,
		venue: text(data[mapping.venue]) ?? null,
		...(slug ? { slug } : {}),
	};
}

/** Read an entry's info through the settings (2 bridge calls: settings, entry). */
export async function readEntryInfo(
	deps: Pick<EventInfoDeps, "settings" | "content">,
	eventId: string,
): Promise<EventInfoDoc | null> {
	const mapping = mappingOf(await deps.settings.list());
	const entry = await deps.content.get(mapping.collection, eventId);
	return entry ? infoOfEntry(entry as unknown as Record<string, unknown>, mapping) : null;
}

/** A stored info as the emails' shape, with the occurrence's start when the booking has one. */
export function eventInfoOf(doc: EventInfoDoc, occurrence?: OccurrenceDoc | null): EventInfo | null {
	const entryStart = instant(doc.startsAt);
	const startsAt = occurrence ? (instant(occurrence.startsAt) ?? entryStart) : entryStart;
	if (startsAt === undefined) return null;
	const duration = entryStart !== undefined ? (instant(doc.endsAt) ?? entryStart) - entryStart : 0;
	const endsAt = occurrence ? (instant(occurrence.endsAt) ?? startsAt + duration) : instant(doc.endsAt);
	return {
		title: text(doc.title) ?? "Event",
		startsAt,
		...(endsAt !== undefined && endsAt > startsAt ? { endsAt } : {}),
		...(doc.timezone ? { timeZone: doc.timezone } : {}),
		...(doc.venue ? { venue: doc.venue } : {}),
	};
}

/**
 * `null` when the event is gone or has no usable start. One call for the config (which carries
 * `info`), one more for a recurring event's occurrence; a config without `info` costs two more
 * (settings, entry).
 */
export async function loadEventInfo(
	deps: EventInfoDeps,
	eventId: string,
	occurrenceId?: string,
	{ publicOnly = false }: { publicOnly?: boolean } = {},
): Promise<EventInfo | null> {
	const config = (await deps.storage.event_configs.get(eventId)) as EventConfigDoc | null;
	// What anyone may see (public/event/ics): a configured event out of draft that is still live,
	// like `public/event`. Without the check a draft or unpublished entry's details would leak.
	if (publicOnly && (!config || config.status === "draft" || config.orphaned || config.unpublished)) return null;
	const doc = config?.info ?? (await readEntryInfo(deps, eventId));
	if (!doc) return null;
	const occurrence = occurrenceId ? ((await deps.storage.occurrences.get(occurrenceId)) as OccurrenceDoc | null) : null;
	return eventInfoOf(doc, occurrence);
}
