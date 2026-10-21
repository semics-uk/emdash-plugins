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

const badRequest = (issues?: unknown) => ({ ...toRouteError("BAD_REQUEST").body, ...(issues ? { issues } : {}) });

function eventIdOf(input: unknown): string | null {
	const id = (input as { eventId?: unknown } | null | undefined)?.eventId;
	return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
}

async function load(eventId: string, ctx: Ctx) {
	const storage = ctx.storage as Record<
		string,
		{ get(id: string): Promise<unknown>; query(o: unknown): Promise<{ items: Array<{ id: string; data: unknown }> }> }
	>;
	const where = { eventId };
	const [config, tts, occs] = await Promise.all([
		storage.event_configs?.get(eventId) as Promise<EventConfigDoc | null>,
		storage.ticket_types?.query({ where, limit: 100 }),
		storage.occurrences?.query({ where, orderBy: { startsAt: "asc" }, limit: 100 }),
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

export const CONFIG_ROUTES: Record<string, RouteDef> = {
	"config/get": {
		handler: (async (routeCtx, ctx) => {
			const eventId = eventIdOf(routeCtx.input);
			if (!eventId) return badRequest();
			const state = await load(eventId, ctx);
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
		handler: (async (routeCtx, ctx) => {
			const eventId = eventIdOf(routeCtx.input);
			if (!eventId) return badRequest();
			const state = await load(eventId, ctx);
			const existing: ExistingState = {
				config: state.config,
				ticketTypes: new Map(state.ticketTypes.map((i) => [i.id, i.data as TicketTypeDoc])),
				occurrences: new Map(state.occurrences.map((i) => [i.id, i.data as OccurrenceDoc])),
			};
			const result = validateConfigInput(eventId, routeCtx.input, existing, () => crypto.randomUUID());
			if (!result.ok) return badRequest(result.error);
			const v = result.value;
			const storage = ctx.storage as unknown as Record<
				string,
				{
					put(id: string, d: unknown): Promise<void>;
					putMany(items: Array<{ id: string; data: unknown }>): Promise<void>;
					deleteMany(ids: string[]): Promise<number>;
				}
			>;
			// Known race: this rewrites reserved/sold read above; the inventory task should guard counters.
			await storage.event_configs?.put(eventId, v.config);
			if (v.ticketTypes.length) await storage.ticket_types?.putMany(v.ticketTypes);
			if (v.occurrences.length) await storage.occurrences?.putMany(v.occurrences);
			if (v.deleteTicketTypeIds.length) await storage.ticket_types?.deleteMany(v.deleteTicketTypeIds);
			if (v.deleteOccurrenceIds.length) await storage.occurrences?.deleteMany(v.deleteOccurrenceIds);
			return { ok: true, eventId };
		}) as Handler,
	},
};
