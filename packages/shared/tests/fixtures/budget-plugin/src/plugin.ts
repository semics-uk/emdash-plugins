import type { SandboxedPlugin } from "emdash/plugin";

/** Deterministic pure-CPU workload: `rounds` xorshift steps. Returns a checksum so it can't be elided. */
function spin(rounds: number): number {
	let x = 2463534242;
	for (let i = 0; i < rounds; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
	}
	return x >>> 0;
}

function count(input: unknown): number {
	const n = (input as { n?: unknown } | null)?.n;
	return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Test-only plugin (never published). Each route makes a known number of bridge calls so
 * tests/budget.host.test.ts can check the T007 harness counts exactly what crosses the sandbox boundary.
 */
const plugin: SandboxedPlugin = {
	hooks: {
		cron: {
			handler: async (_event, ctx) => {
				await ctx.kv.get("cron:last");
				await ctx.kv.set("cron:last", "ran");
			},
		},
	},
	routes: {
		/** `n` sequential storage gets (n bridge calls). */
		gets: {
			handler: async ({ input }, ctx) => {
				const n = count(input);
				for (let i = 0; i < n; i++) await ctx.storage.items.get(`k${i}`);
				return { n };
			},
		},
		/** `n` storage gets in parallel (n bridge calls, overlapping in time). */
		parallel: {
			handler: async ({ input }, ctx) => {
				const n = count(input);
				await Promise.all(Array.from({ length: n }, (_, i) => ctx.storage.items.get(`p${i}`)));
				return { n };
			},
		},
		/** One batched read of `n` ids (1 bridge call). */
		batch: {
			handler: async ({ input }, ctx) => {
				const ids = Array.from({ length: count(input) }, (_, i) => `b${i}`);
				const found = await ctx.storage.items.getMany(ids);
				return { found: found.size };
			},
		},
		/** One call of each common kind: settings, kv, storage, log. */
		mixed: {
			handler: async (_routeCtx, ctx) => {
				await ctx.settings.get("greeting");
				await ctx.kv.get("counter");
				await ctx.storage.items.put("m1", { ok: true });
				ctx.log.info("mixed done");
				return { ok: true };
			},
		},
		/** Fixed CPU workload, no bridge calls. */
		spin: {
			handler: async ({ input }) => ({ checksum: spin(count(input)) }),
		},
		/** A route that throws after one bridge call. */
		fails: {
			handler: async (_routeCtx, ctx) => {
				await ctx.kv.get("x");
				throw new Error("fixture failure");
			},
		},
	},
};

export default plugin;
