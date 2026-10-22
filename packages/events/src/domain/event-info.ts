import type { OccurrenceDoc } from "../storage/schema";

/**
 * What emails and calendar files need to know about an event: read from the site's content entry
 * (snake_case fields `title`, `starts_at`, `ends_at`, `timezone`, `venue`, in the collection named
 * by the `eventsCollection` setting) and, for a recurring event's booking, the occurrence's start.
 * Costs 2 bridge calls (setting, entry), 3 with an occurrence.
 */
export interface EventInfo {
	title: string;
	startsAt: number;
	endsAt?: number;
	timeZone?: string;
	venue?: string;
}

export interface EventInfoDeps {
	settings: { get<T>(key: string): Promise<T | null> };
	content: { get(collection: string, id: string): Promise<{ data: Record<string, unknown> } | null> };
	storage: { occurrences: { get(id: string): Promise<unknown> } };
}

const DEFAULT_COLLECTION = "events";

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const instant = (v: unknown): number | undefined => {
	const ms = typeof v === "string" ? Date.parse(v) : Number.NaN;
	return Number.isFinite(ms) ? ms : undefined;
};

export async function eventCollection(settings: EventInfoDeps["settings"]): Promise<string> {
	return text(await settings.get<string>("eventsCollection")) ?? DEFAULT_COLLECTION;
}

/** `null` when the entry is gone or has no usable start. */
export async function loadEventInfo(
	deps: EventInfoDeps,
	eventId: string,
	occurrenceId?: string,
): Promise<EventInfo | null> {
	const entry = await deps.content.get(await eventCollection(deps.settings), eventId);
	if (!entry) return null;
	const d = entry.data;
	const occurrence = occurrenceId ? ((await deps.storage.occurrences.get(occurrenceId)) as OccurrenceDoc | null) : null;
	const entryStart = instant(d.starts_at);
	const startsAt = occurrence ? (instant(occurrence.startsAt) ?? entryStart) : entryStart;
	if (startsAt === undefined) return null;
	const duration = entryStart !== undefined ? (instant(d.ends_at) ?? entryStart) - entryStart : 0;
	const endsAt = occurrence ? (instant(occurrence.endsAt) ?? startsAt + duration) : instant(d.ends_at);
	const timeZone = text(d.timezone);
	const venue = text(d.venue);
	return {
		title: text(d.title) ?? "Event",
		startsAt,
		...(endsAt !== undefined && endsAt > startsAt ? { endsAt } : {}),
		...(timeZone ? { timeZone } : {}),
		...(venue ? { venue } : {}),
	};
}
