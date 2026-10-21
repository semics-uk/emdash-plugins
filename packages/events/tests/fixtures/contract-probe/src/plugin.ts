import type { SandboxedPlugin } from "emdash/plugin";

type Input = Record<string, unknown>;
const input = (r: { input?: unknown }): Input => (r.input ?? {}) as Input;

interface Collection {
	put(id: string, data: unknown): Promise<void>;
	query(options?: unknown): Promise<{ items: Array<{ id: string; data: unknown }> }>;
}

const collection = (storage: unknown, name: unknown): Collection =>
	(storage as Record<string, Collection>)[String(name)] as Collection;

/**
 * Test-only plugin (never published). Its emdash-plugin.jsonc is a symlink to the real manifest, so
 * the trust contract and storage declarations under test are the shipped ones. The routes let the
 * tests drive storage and outbound HTTP from inside the sandbox.
 */
const plugin: SandboxedPlugin = {
	routes: {
		"probe/put": {
			handler: async (r, ctx) => {
				const i = input(r);
				try {
					await collection(ctx.storage, i.collection).put(String(i.id), i.data);
					return { ok: true };
				} catch (e) {
					return { ok: false, error: String(e) };
				}
			},
		},
		"probe/query": {
			handler: async (r, ctx) => {
				const i = input(r);
				try {
					const res = await collection(ctx.storage, i.collection).query({
						where: i.where,
						orderBy: i.orderBy,
					});
					return { ok: true, ids: res.items.map((item) => item.id) };
				} catch (e) {
					return { ok: false, error: String(e) };
				}
			},
		},
		"probe/fetch": {
			handler: async (r, ctx) => {
				try {
					const res = await ctx.http!.fetch(String(input(r).url));
					return { ok: true, status: res.status };
				} catch (e) {
					return { ok: false, error: String(e) };
				}
			},
		},
	},
};

export default plugin;
