import { toRouteError } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type ConfigIssue, catalogOf, type ExistingState, validateConfigInput } from "../domain/config";
import { readEntryInfo } from "../domain/event-info";
import { counterlessChanges, retireCounted, type UpdateIfArgsLike, updateCountedFields } from "../domain/inventory";
import type { EventConfigDoc, EventInfoDoc, OccurrenceDoc, TicketTypeDoc } from "../storage/schema";

/**
 * Private (admin) config routes: `config/get` and `config/save` (EV-FR-02, EV-FR-03). Thin adapters
 * over `validateConfigInput`; at most 8 bridge calls per invocation.
 *
 * `config/save` never rewrites a stored counted document: the counters belong to the inventory
 * module, and a reservation may land between this route's read and its write. Existing documents
 * get a guarded `updateIf` of their changed fields only; new ones are created with zero counters.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Ctx = PluginContext;
type Handler = (routeCtx: { input?: unknown }, ctx: Ctx) => Promise<unknown>;

interface Collection {
	get(id: string): Promise<unknown>;
	getMany(ids: string[]): Promise<Map<string, unknown>>;
	put(id: string, d: unknown): Promise<void>;
	putMany(items: Array<{ id: string; data: unknown }>): Promise<void>;
	deleteMany(ids: string[]): Promise<number>;
	query(o: unknown): Promise<{ items: Array<{ id: string; data: unknown }> }>;
	updateIf(id: string, args: UpdateIfArgsLike): Promise<{ applied: boolean }>;
}

/** Bridge-call target for one invocation (R22); `load` makes 3 of them. */
const MAX_SAVE_CALLS = 8;
const LOAD_CALLS = 3;

/** The storage collections `config/save` touches (an injectable seam for the race tests). */
export interface ConfigStorage {
	event_configs: Collection;
	ticket_types: Collection;
	occurrences: Collection;
}

const badRequest = (issues?: unknown) => ({ ...toRouteError("BAD_REQUEST").body, ...(issues ? { issues } : {}) });

function eventIdOf(input: unknown): string | null {
	const id = (input as { eventId?: unknown } | null | undefined)?.eventId;
	return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
}

export async function loadEventState(eventId: string, storage: ConfigStorage) {
	const where = { eventId };
	const [config, tts, occs] = await Promise.all([
		storage.event_configs.get(eventId) as Promise<EventConfigDoc | null>,
		storage.ticket_types.query({ where, limit: 100 }),
		storage.occurrences.query({ where, orderBy: { startsAt: "asc" }, limit: 100 }),
	]);
	return {
		config: config ?? null,
		ticketTypes: tts?.items ?? [],
		occurrences: occs?.items ?? [],
	};
}

const byName = (a: { data: unknown }, b: { data: unknown }) => {
	const x = a.data as TicketTypeDoc;
	const y = b.data as TicketTypeDoc;
	return x.sort - y.sort || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
};

export type EventState = Awaited<ReturnType<typeof loadEventState>>;

/** `config/save`: validate against stored state, then write. Returns the route's response body. */
export async function saveConfig(
	storage: ConfigStorage,
	input: unknown,
	newId: () => string,
	/** State the caller just loaded (the admin editor), so the save does not read it again. */
	preloaded?: EventState,
	/**
	 * Reads the event's public info from its content entry (2 bridge calls). Called once, and only
	 * when the save creates the config, so later saves cost nothing extra; the content hook keeps it
	 * fresh afterwards (and fills it in for a config saved before it existed).
	 */
	loadInfo?: () => Promise<EventInfoDoc | null>,
	/** Called after a successful save with the event as it now stands (no read back; the editor panel renders it). */
	onSaved?: (state: EventState) => void,
): Promise<unknown> {
	const eventId = eventIdOf(input);
	if (!eventId) return badRequest();
	const state = preloaded ?? (await loadEventState(eventId, storage));
	const existing: ExistingState = {
		config: state.config,
		ticketTypes: new Map(state.ticketTypes.map((i) => [i.id, i.data as TicketTypeDoc])),
		occurrences: new Map(state.occurrences.map((i) => [i.id, i.data as OccurrenceDoc])),
	};
	const result = validateConfigInput(eventId, input, existing, newId);
	if (!result.ok) return badRequest(result.error);
	const v = result.value;

	// Plan: edits of stored documents (one guarded call each, only if something changed),
	// retirements before deletes (one call each, plus one deleteMany), creations (one putMany).
	type Edit = { collection: Collection; id: string; stored: object; next: { capacity: number }; path: string };
	const edits: Edit[] = [];
	if (state.config) {
		edits.push({
			collection: storage.event_configs,
			id: eventId,
			stored: state.config,
			next: v.config,
			path: "config",
		});
	}
	const split = <T extends { capacity: number }>(
		name: "ticketTypes" | "occurrences",
		collection: Collection,
		items: Array<{ id: string; data: T }>,
		stored: ReadonlyMap<string, T>,
	) =>
		items.filter((item, index) => {
			const prior = stored.get(item.id);
			if (prior) edits.push({ collection, id: item.id, stored: prior, next: item.data, path: `${name}[${index}]` });
			return !prior;
		});
	const newTicketTypes = split("ticketTypes", storage.ticket_types, v.ticketTypes, existing.ticketTypes);
	const newOccurrences = split("occurrences", storage.occurrences, v.occurrences, existing.occurrences);
	const changed = edits.filter((e) => counterlessChanges(e.stored, e.next) !== null);
	const deletes = [
		{ name: "ticketTypes", collection: storage.ticket_types, ids: v.deleteTicketTypeIds },
		{ name: "occurrences", collection: storage.occurrences, ids: v.deleteOccurrenceIds },
	].filter((d) => d.ids.length > 0);
	// The checkout catalog on the config mirrors the documents as they end up, including after a
	// partly failed save, so it is rewritten (one call, only when it changes) on every exit below.
	const storedCatalog = state.config?.catalog ?? null;
	const target = catalogOf(v.ticketTypes, v.occurrences);
	const calls =
		LOAD_CALLS +
		(state.config ? 0 : 1) +
		changed.length +
		deletes.reduce((n, d) => n + d.ids.length + 1, 0) +
		(newTicketTypes.length > 0 ? 1 : 0) +
		(newOccurrences.length > 0 ? 1 : 0) +
		(state.config && !sameJson(storedCatalog, target) ? 1 : 0);
	if (calls > MAX_SAVE_CALLS) return badRequest([{ path: "input", code: "TOO_MANY_CHANGES" } satisfies ConfigIssue]);

	const info: EventInfoDoc | null = state.config || !loadInfo ? null : await loadInfo().catch(() => null);

	const effective = {
		ticketTypes: new Map(existing.ticketTypes),
		occurrences: new Map(existing.occurrences),
	};
	const writeCatalog = async () => {
		const entries = <T>(m: Map<string, T>) => [...m].map(([id, data]) => ({ id, data }));
		const catalog = catalogOf(entries(effective.ticketTypes), entries(effective.occurrences));
		if (sameJson(storedCatalog, catalog) && !info) return;
		await storage.event_configs.updateIf(eventId, { where: {}, set: { catalog, ...(info ? { info } : {}) } });
	};

	// 1. Edits, guarded on what is reserved at write time (EV-FR-03).
	const outcomes = await Promise.all(changed.map((e) => updateCountedFields(e.collection, e.id, e.stored, e.next)));
	changed.forEach((e, i) => {
		if (outcomes[i] !== "applied") return;
		// `path` names the list (the storage proxy hands out a new collection object per access).
		if (e.path.startsWith("ticketTypes[")) effective.ticketTypes.set(e.id, e.next as TicketTypeDoc);
		if (e.path.startsWith("occurrences[")) effective.occurrences.set(e.id, e.next as OccurrenceDoc);
	});
	const conflicts = changed
		.filter((_, i) => outcomes[i] === "conflict")
		.map((e): ConfigIssue => {
			const cut = e.next.capacity < (e.stored as { capacity: number }).capacity;
			return cut
				? { path: `${e.path}.capacity`, code: "CAPACITY_BELOW_RESERVED" }
				: { path: `${e.path}.id`, code: "UNKNOWN_ID" };
		});
	if (conflicts.length > 0) {
		if (state.config) await writeCatalog();
		return badRequest(conflicts);
	}

	// 2. Deletes: close each document to reservations first; one that took a seat meanwhile stays.
	const inUse: ConfigIssue[] = [];
	await Promise.all(
		deletes.map(async (d) => {
			const retired = await Promise.all(d.ids.map((id) => retireCounted(d.collection, id)));
			const ids = d.ids.filter((_, i) => retired[i]);
			if (ids.length > 0) await d.collection.deleteMany(ids);
			const map = d.name === "ticketTypes" ? effective.ticketTypes : effective.occurrences;
			for (const id of ids) map.delete(id);
			if (ids.length < d.ids.length) inUse.push({ path: d.name, code: "ITEM_IN_USE" });
		}),
	);
	if (inUse.length > 0) {
		if (state.config) await writeCatalog();
		return badRequest(inUse);
	}

	// 3. Creations, with zero counters; a new config goes last, carrying its catalog.
	if (newTicketTypes.length > 0) await storage.ticket_types.putMany(newTicketTypes);
	if (newOccurrences.length > 0) await storage.occurrences.putMany(newOccurrences);
	for (const t of newTicketTypes) effective.ticketTypes.set(t.id, t.data);
	for (const o of newOccurrences) effective.occurrences.set(o.id, o.data);
	if (!state.config) {
		await storage.event_configs.put(eventId, { ...v.config, catalog: target, ...(info ? { info } : {}) });
	} else {
		await writeCatalog();
	}
	onSaved?.({
		config: state.config
			? { ...state.config, ...v.config }
			: { ...v.config, catalog: target, ...(info ? { info } : {}) },
		ticketTypes: [...effective.ticketTypes].map(([id, data]) => ({ id, data })),
		occurrences: [...effective.occurrences]
			.map(([id, data]) => ({ id, data }))
			.sort((a, b) => (a.data.startsAt < b.data.startsAt ? -1 : a.data.startsAt > b.data.startsAt ? 1 : 0)),
	});
	return { ok: true, eventId };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const configStorage = (ctx: Ctx) => ctx.storage as unknown as ConfigStorage;

export const CONFIG_ROUTES: Record<string, RouteDef> = {
	"config/get": {
		handler: (async (routeCtx, ctx) => {
			const eventId = eventIdOf(routeCtx.input);
			if (!eventId) return badRequest();
			const state = await loadEventState(eventId, configStorage(ctx));
			if (!state.config) return toRouteError("NOT_FOUND").body;
			const { catalog: _derived, info: _info, ...config } = state.config;
			return {
				ok: true,
				config,
				ticketTypes: [...state.ticketTypes].sort(byName).map((i) => ({ id: i.id, ...(i.data as TicketTypeDoc) })),
				occurrences: state.occurrences.map((i) => ({ id: i.id, ...(i.data as OccurrenceDoc) })),
			};
		}) as Handler,
	},
	"config/save": {
		handler: (async (routeCtx, ctx) =>
			saveConfig(
				configStorage(ctx),
				routeCtx.input,
				() => crypto.randomUUID(),
				undefined,
				() =>
					readEntryInfo(
						{ settings: ctx.settings, content: ctx.content ?? { get: async () => null } },
						eventIdOf(routeCtx.input) ?? "",
					),
			)) as Handler,
	},
};
