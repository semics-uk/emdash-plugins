import type { SandboxedPlugin } from "emdash/plugin";

type Input = Record<string, unknown>;
const input = (r: { input?: unknown }): Input => (r.input ?? {}) as Input;

const plugin: SandboxedPlugin = {
	hooks: {
		cron: async (event, ctx) => {
			const prev = (await ctx.kv.get<number>(`cron:${event.name}`)) ?? 0;
			await ctx.kv.set(`cron:${event.name}`, prev + 1);
		},
		"content:beforeDelete": async (_event, ctx) => {
			const mode = await ctx.kv.get<string>("deleteMode");
			await ctx.kv.set("beforeDeleteCalls", ((await ctx.kv.get<number>("beforeDeleteCalls")) ?? 0) + 1);
			if (mode === "false") return false;
			if (mode === "cancel") return { cancel: true, reason: "probe veto" } as unknown as boolean;
			return undefined;
		},
		"content:afterDelete": async (_event, ctx) => {
			await ctx.kv.set("afterDeleteCalls", ((await ctx.kv.get<number>("afterDeleteCalls")) ?? 0) + 1);
		},
	},
	routes: {
		"cron/schedule": {
			handler: async (r, ctx) => {
				const i = input(r);
				try {
					await ctx.cron.schedule(String(i.name), { schedule: String(i.schedule), data: { n: 1 } });
					return { ok: true, list: await ctx.cron.list() };
				} catch (e) {
					return { ok: false, error: String(e) };
				}
			},
		},
		"kv/get": { handler: async (r, ctx) => ({ value: await ctx.kv.get(String(input(r).key)) }) },
		"kv/set": {
			handler: async (r, ctx) => {
				await ctx.kv.set(String(input(r).key), input(r).value);
				return { ok: true };
			},
		},
		"doc/put": {
			handler: async (r, ctx) => {
				const i = input(r);
				const bytes = Number(i.bytes);
				const doc = { pad: "a".repeat(bytes) };
				try {
					await ctx.storage.docs.put(String(i.id), doc);
					const back = (await ctx.storage.docs.get(String(i.id))) as { pad?: string } | null;
					return { ok: true, roundTrip: back?.pad?.length === bytes, jsonBytes: JSON.stringify(doc).length };
				} catch (e) {
					return { ok: false, error: String(e) };
				}
			},
		},
		"setting/set": {
			handler: async (r, ctx) => {
				await ctx.settings.set(String(input(r).key), input(r).value);
				return { got: await ctx.settings.get(String(input(r).key)) };
			},
		},
	},
};

export default plugin;
