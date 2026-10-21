import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import {
	type CounterStorage,
	type InventoryStorage,
	planReservation,
	repairEventCounters,
	reserve,
} from "../../../../src/domain/inventory";
import { CONFIG_ROUTES, type ConfigStorage, saveConfig } from "../../../../src/routes/config";

/**
 * Test-only plugin (never published). Its emdash-plugin.jsonc is a symlink to the real manifest, so
 * the storage under test is the shipped declaration on D1. The routes drive `src/domain/inventory.ts`
 * from inside the sandbox, with optional failure injection, and run `config/save` with a reservation
 * landing between its read and its write.
 */

type Input = Record<string, unknown>;
type Line = { ticketTypeId: string; qty: number };
type Counted = { capacity: number; reserved: number };

const input = (r: { input?: unknown }): Input => (r.input ?? {}) as Input;
const store = (ctx: PluginContext) => ctx.storage as unknown as InventoryStorage & Record<string, any>;

/** Read the counted documents for a request and reserve against `target`. */
async function readAndReserve(ctx: PluginContext, i: Input, target: CounterStorage) {
	const s = store(ctx);
	const lines = (i.lines ?? []) as Line[];
	const eventId = String(i.eventId);
	const occurrenceId = typeof i.occurrenceId === "string" ? i.occurrenceId : undefined;
	const [event, occurrence, ticketTypes] = await Promise.all([
		s.event_configs.get(eventId) as Promise<Counted | null>,
		occurrenceId ? (s.occurrences.get(occurrenceId) as Promise<Counted | null>) : Promise.resolve(null),
		s.ticket_types.getMany([...new Set(lines.map((l) => l.ticketTypeId))]) as Promise<Map<string, Counted>>,
	]);
	if (!event) return { ok: false, code: "NOT_FOUND" };
	const plan = planReservation({
		eventId,
		event,
		...(occurrenceId ? { occurrenceId, occurrence: occurrence ?? undefined } : {}),
		ticketTypes,
		lines,
	});
	if (!plan.ok) return { ok: false, ...plan.error };
	const r = await reserve(target, plan.value);
	if (r.ok) return { ok: true, steps: r.value.map(({ collection, id, qty }) => ({ collection, id, qty })) };
	const { cause, ...error } = r.error as typeof r.error & { cause?: unknown };
	return { ok: false, ...error, ...(cause ? { cause: String(cause) } : {}) };
}

/** Storage whose `failAt`-th reserving `updateIf` (1-based, increments only) throws. */
function failing(ctx: PluginContext, failAt: number | undefined): CounterStorage {
	const s = store(ctx);
	let n = 0;
	const wrap = (name: keyof CounterStorage) => ({
		updateIf: async (id: string, args: Parameters<CounterStorage["ticket_types"]["updateIf"]>[1]) => {
			const inc = args.delta?.reserved && "inc" in args.delta.reserved;
			if (inc && ++n === failAt) throw new Error("injected failure");
			return s[name].updateIf(id, args as never);
		},
	});
	return { ticket_types: wrap("ticket_types"), occurrences: wrap("occurrences"), event_configs: wrap("event_configs") };
}

const plugin: SandboxedPlugin = {
	routes: {
		...CONFIG_ROUTES,
		"probe/seed": {
			handler: async (r, ctx) => {
				const i = input(r);
				await store(ctx)[String(i.collection)].putMany(i.items as Array<{ id: string; data: unknown }>);
				return { ok: true };
			},
		},
		"probe/reserve": {
			handler: async (r, ctx) => {
				const i = input(r);
				return readAndReserve(ctx, i, failing(ctx, typeof i.failAt === "number" ? i.failAt : undefined));
			},
		},
		"probe/repair": {
			handler: async (r, ctx) => {
				const i = input(r);
				return repairEventCounters(store(ctx), String(i.eventId), Date.parse(String(i.now)));
			},
		},
		"probe/config-save-race": {
			// config/save, with a reservation committed right after config/save has read the ticket types.
			handler: async (r, ctx) => {
				const i = input(r);
				const s = store(ctx);
				let raced: unknown;
				const storage: ConfigStorage = {
					event_configs: s.event_configs,
					occurrences: s.occurrences,
					ticket_types: {
						get: (id) => s.ticket_types.get(id),
						getMany: (ids) => s.ticket_types.getMany(ids),
						put: (id, d) => s.ticket_types.put(id, d),
						putMany: (items) => s.ticket_types.putMany(items),
						deleteMany: (ids) => s.ticket_types.deleteMany(ids),
						updateIf: (id, args) => s.ticket_types.updateIf(id, args as never),
						query: async (o) => {
							const res = await s.ticket_types.query(o);
							raced = await readAndReserve(ctx, i.race as Input, s);
							return res;
						},
					},
				};
				const saved = await saveConfig(storage, i.input, () => crypto.randomUUID());
				return { saved, raced };
			},
		},
	},
};

export default plugin;
