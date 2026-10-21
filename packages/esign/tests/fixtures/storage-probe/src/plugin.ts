import type { SandboxedPlugin } from "emdash/plugin";

/**
 * Test-only plugin (never published). Its manifest is a symlink to the real e-sign manifest, so
 * storage declarations and allowed hosts are exactly the shipped trust contract. Generic probes let
 * tests exercise storage indexes and the network allow-list through the production sandbox bridge.
 */
interface Collection {
	put(id: string, data: unknown): Promise<void>;
	query(options: unknown): Promise<{ items: Array<{ id: string }>; hasMore: boolean }>;
	count(where?: unknown): Promise<number>;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const plugin: SandboxedPlugin = {
	routes: {
		put: {
			handler: async (routeCtx, ctx) => {
				const input = routeCtx.input as { collection: string; id: string; data: unknown };
				const store = (ctx.storage as unknown as Record<string, Collection>)[input.collection];
				try {
					await store?.put(input.id, input.data);
					return { ok: true };
				} catch (error) {
					return { ok: false, message: describeError(error) };
				}
			},
		},
		query: {
			handler: async (routeCtx, ctx) => {
				const input = routeCtx.input as { collection: string; where: unknown };
				const store = (ctx.storage as unknown as Record<string, Collection>)[input.collection];
				try {
					const result = await store?.query({ where: input.where, limit: 100 });
					const count = await store?.count(input.where);
					return { ok: true, ids: result?.items.map((item) => item.id) ?? [], count };
				} catch (error) {
					return { ok: false, message: describeError(error) };
				}
			},
		},
		fetch: {
			handler: async (routeCtx, ctx) => {
				const input = routeCtx.input as { url: string };
				try {
					const response = await ctx.http?.fetch(input.url);
					return { ok: true, status: response?.status };
				} catch (error) {
					return { ok: false, message: describeError(error) };
				}
			},
		},
	},
};

export default plugin;
