import { toRouteError } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type ExistingState, validateConfigInput } from "../domain/config";
import type { EventConfigDoc, OccurrenceDoc, TicketTypeDoc } from "../storage/schema";

/**
 * Private (admin) config routes: `config/get` and `config/save` (EV-FR-02, EV-FR-03). Thin adapters
 * over `validateConfigInput`; at most 8 bridge calls per invocation.
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
	updateIf(id: string, args: unknown): Promise<{ applied: boolean }>;
}

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

async function load(eventId: string, storage: ConfigStorage) {
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

/** `config/save`: validate against stored state, then write. Returns the route's response body. */
export async function saveConfig(storage: ConfigStorage, input: unknown, newId: () => string): Promise<unknown> {
	const eventId = eventIdOf(input);
	if (!eventId) return badRequest();
	const state = await load(eventId, storage);
	const existing: ExistingState = {
		config: state.config,
		ticketTypes: new Map(state.ticketTypes.map((i) => [i.id, i.data as TicketTypeDoc])),
		occurrences: new Map(state.occurrences.map((i) => [i.id, i.data as OccurrenceDoc])),
	};
	const result = validateConfigInput(eventId, input, existing, newId);
	if (!result.ok) return badRequest(result.error);
	const v = result.value;
	// Known race: this rewrites reserved/sold read above; the inventory task should guard counters.
	await storage.event_configs.put(eventId, v.config);
	if (v.ticketTypes.length) await storage.ticket_types.putMany(v.ticketTypes);
	if (v.occurrences.length) await storage.occurrences.putMany(v.occurrences);
	if (v.deleteTicketTypeIds.length) await storage.ticket_types.deleteMany(v.deleteTicketTypeIds);
	if (v.deleteOccurrenceIds.length) await storage.occurrences.deleteMany(v.deleteOccurrenceIds);
	return { ok: true, eventId };
}

const configStorage = (ctx: Ctx) => ctx.storage as unknown as ConfigStorage;

export const CONFIG_ROUTES: Record<string, RouteDef> = {
	"config/get": {
		handler: (async (routeCtx, ctx) => {
			const eventId = eventIdOf(routeCtx.input);
			if (!eventId) return badRequest();
			const state = await load(eventId, configStorage(ctx));
			if (!state.config) return toRouteError("NOT_FOUND").body;
			return {
				ok: true,
				config: state.config,
				ticketTypes: [...state.ticketTypes].sort(byName).map((i) => ({ id: i.id, ...(i.data as TicketTypeDoc) })),
				occurrences: state.occurrences.map((i) => ({ id: i.id, ...(i.data as OccurrenceDoc) })),
			};
		}) as Handler,
	},
	"config/save": {
		handler: (async (routeCtx, ctx) =>
			saveConfig(configStorage(ctx), routeCtx.input, () => crypto.randomUUID())) as Handler,
	},
};
