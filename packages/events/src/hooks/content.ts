import type { ContentDeleteEvent, ContentHookEvent, ContentStateChangeEvent, PluginContext } from "emdash/plugin";

import { infoOfEntry, mappingOf } from "../domain/event-info";
import { LIVE_BOOKING_STATUSES } from "../domain/inventory";

/**
 * `content:afterSave`: keep the copy of the entry's public info (title, times, zone, venue) on the
 * event's config current, so the public routes, emails and calendar files read one document (T046).
 * It reads the saved fields from the event, through the mapping settings, and writes only when the
 * save is for the events collection, the entry has a config and a usable start. Two bridge calls
 * (settings, one guarded write); a save of any other collection costs the settings read only.
 */
export interface InfoHookDeps {
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	storage: {
		event_configs: {
			updateIf(id: string, args: { where: Record<string, unknown>; set: Record<string, unknown> }): Promise<unknown>;
		};
	};
}

export const refreshEventInfo = (
	deps: InfoHookDeps,
	event: Pick<ContentHookEvent, "collection" | "content">,
): Promise<void> => markUnpublished(deps, event);

export const contentAfterSave = async (event: ContentHookEvent, ctx: PluginContext): Promise<void> =>
	refreshEventInfo({ settings: ctx.settings, storage: ctx.storage as unknown as InfoHookDeps["storage"] }, event);

/**
 * The publish-state and delete hooks (EV-FR-10, Spike S9). Each starts with the settings read that
 * names the events collection and ignores every other collection, then does one storage call:
 *
 * - `content:afterUnpublish` flags the config `unpublished`: sales stop (checkout answers
 *   `NOT_FOUND`) and the event leaves `public/events`, `public/event` and the JSON-LD.
 * - `content:afterPublish` clears the flag and refreshes `info` (a publish may not fire a save).
 * - `content:beforeDelete` returns exactly `false` while the event has live bookings (the S9 veto:
 *   `{ cancel: true }` is ignored for this hook; it needs `content:read` and nothing more).
 * - `content:afterDelete` marks the config `orphaned`, the backstop for a permanent delete, which
 *   skips `beforeDelete`. Orphaned events are hidden like unpublished ones.
 */
export { LIVE_BOOKING_STATUSES };

export interface StateHookDeps extends InfoHookDeps {
	storage: InfoHookDeps["storage"] & {
		bookings: { query(o: { where: Record<string, unknown>; limit: number }): Promise<{ items: unknown[] }> };
	};
	log: { warn(message: string, data?: unknown): void };
}

const depsOf = (ctx: PluginContext): StateHookDeps => ({
	settings: ctx.settings,
	storage: ctx.storage as unknown as StateHookDeps["storage"],
	log: ctx.log,
});

const isEvents = async (deps: InfoHookDeps, collection: string) =>
	collection === mappingOf(await deps.settings.list()).collection;

/**
 * Sets `unpublished` and, unless unpublishing, refreshes `info`. Without `unpublished` (a save) it
 * only refreshes `info`, and writes nothing when the entry has no usable start. `where: {}` matches
 * any stored config; an entry that has none (a plain page) is left alone.
 */
export async function markUnpublished(
	deps: InfoHookDeps,
	event: Pick<ContentStateChangeEvent, "collection" | "content">,
	unpublished?: boolean,
): Promise<void> {
	const id = event.content.id;
	if (typeof id !== "string" || id === "") return;
	const mapping = mappingOf(await deps.settings.list());
	if (event.collection !== mapping.collection) return;
	const info = unpublished ? null : infoOfEntry(event.content, mapping);
	if (unpublished === undefined && !info) return;
	await deps.storage.event_configs.updateIf(id, {
		where: {},
		set: { ...(unpublished === undefined ? {} : { unpublished }), ...(info ? { info } : {}) },
	});
}

export async function vetoDelete(deps: StateHookDeps, event: ContentDeleteEvent): Promise<false | undefined> {
	if (!(await isEvents(deps, event.collection))) return undefined;
	const { items } = await deps.storage.bookings.query({
		where: { eventId: event.id, status: { in: [...LIVE_BOOKING_STATUSES] } },
		limit: 1,
	});
	if (items.length === 0) return undefined;
	deps.log.warn("event delete blocked: it has bookings", { eventId: event.id });
	return false;
}

export async function orphanConfig(deps: InfoHookDeps, event: ContentDeleteEvent): Promise<void> {
	if (!(await isEvents(deps, event.collection))) return;
	await deps.storage.event_configs.updateIf(event.id, { where: {}, set: { orphaned: true } });
}

export const contentAfterUnpublish = async (event: ContentStateChangeEvent, ctx: PluginContext): Promise<void> =>
	markUnpublished(depsOf(ctx), event, true);
export const contentAfterPublish = async (event: ContentStateChangeEvent, ctx: PluginContext): Promise<void> =>
	markUnpublished(depsOf(ctx), event, false);
export const contentBeforeDelete = async (event: ContentDeleteEvent, ctx: PluginContext): Promise<false | undefined> =>
	vetoDelete(depsOf(ctx), event);
export const contentAfterDelete = async (event: ContentDeleteEvent, ctx: PluginContext): Promise<void> =>
	orphanConfig(depsOf(ctx), event);
