import type { ContentHookEvent, PluginContext } from "emdash/plugin";

import { infoOfEntry, mappingOf } from "./domain/event-info";

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

export async function refreshEventInfo(
	deps: InfoHookDeps,
	event: Pick<ContentHookEvent, "collection" | "content">,
): Promise<void> {
	const id = event.content.id;
	if (typeof id !== "string" || id === "") return;
	const mapping = mappingOf(await deps.settings.list());
	if (event.collection !== mapping.collection) return;
	const info = infoOfEntry(event.content, mapping);
	if (!info) return;
	// `where: {}` matches any stored config; an entry that has none (a plain page) is left alone.
	await deps.storage.event_configs.updateIf(id, { where: {}, set: { info } });
}

export const contentAfterSave = async (event: ContentHookEvent, ctx: PluginContext): Promise<void> =>
	refreshEventInfo({ settings: ctx.settings, storage: ctx.storage as unknown as InfoHookDeps["storage"] }, event);
