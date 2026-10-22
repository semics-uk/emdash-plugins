import { describe, expect, it } from "vitest";
import { hashIp, type RateLimitStore, rateLimit, sweepRateLimits } from "../src/ratelimit";

function memStore() {
	const m = new Map<string, string>();
	const calls = { n: 0 };
	const store: RateLimitStore = {
		async get(k) {
			calls.n++;
			return m.get(k) ?? null;
		},
		async set(k, v) {
			calls.n++;
			m.set(k, v);
		},
	};
	return { store, m, calls };
}

const opts = { scope: "book", limit: 3, windowSeconds: 60, salt: "s" };

describe("rateLimit (EV-NFR-04)", () => {
	it("allows N requests per window and rejects N+1 with RATE_LIMITED", async () => {
		const { store } = memStore();
		for (let i = 0; i < 3; i++) {
			const r = await rateLimit(store, "1.2.3.4", 1000, opts);
			expect(r).toEqual({ ok: true, value: { remaining: 2 - i } });
		}
		expect(await rateLimit(store, "1.2.3.4", 1010, opts)).toEqual({
			ok: false,
			error: "RATE_LIMITED",
		});
	});

	it("keeps separate counters per IP", async () => {
		const { store } = memStore();
		for (let i = 0; i < 3; i++) await rateLimit(store, "1.1.1.1", 0, opts);
		expect((await rateLimit(store, "2.2.2.2", 0, opts)).ok).toBe(true);
	});

	it("resets after the window expires", async () => {
		const { store } = memStore();
		for (let i = 0; i < 3; i++) await rateLimit(store, "1.2.3.4", 1000, opts);
		expect((await rateLimit(store, "1.2.3.4", 1000, opts)).ok).toBe(false);
		expect((await rateLimit(store, "1.2.3.4", 1000 + 60_000, opts)).ok).toBe(true);
	});

	it("never stores the raw IP and costs at most 2 bridge calls", async () => {
		const { store, m, calls } = memStore();
		await rateLimit(store, "203.0.113.9", 0, opts);
		expect(calls.n).toBeLessThanOrEqual(2);
		for (const [k, v] of m) {
			expect(k).not.toContain("203.0.113.9");
			expect(v).not.toContain("203.0.113.9");
		}
		expect(await hashIp("203.0.113.9", "s")).toMatch(/^[0-9a-f]{32}$/);
		expect(await hashIp("203.0.113.9", "s")).not.toBe(await hashIp("203.0.113.9", "t"));
	});

	it("a rejected request costs one call and a corrupt counter counts as zero", async () => {
		const { store, m, calls } = memStore();
		for (let i = 0; i < 3; i++) await rateLimit(store, "a", 0, opts);
		calls.n = 0;
		await rateLimit(store, "a", 0, opts);
		expect(calls.n).toBe(1);
		for (const k of m.keys()) m.set(k, "garbage");
		expect((await rateLimit(store, "a", 0, opts)).ok).toBe(true);
	});
});

describe("rate-limit counters are swept once their window ends (T100, T081)", () => {
	function kvStore() {
		const m = new Map<string, string>();
		const calls = { n: 0 };
		const store = {
			async get(k: string) {
				calls.n++;
				return m.get(k) ?? null;
			},
			async set(k: string, v: string) {
				calls.n++;
				m.set(k, v);
			},
			async list(prefix: string) {
				calls.n++;
				return [...m].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value }));
			},
			async delete(k: string) {
				calls.n++;
				return m.delete(k);
			},
		};
		return { m, calls, store };
	}

	it("a counter records when its window ends (epoch seconds)", async () => {
		const { store, m } = kvStore();
		await rateLimit(store, "1.2.3.4", 90_000, opts);
		expect([...m.values()]).toEqual(["1:120"]);
		await rateLimit(store, "1.2.3.4", 91_000, opts);
		expect([...m.values()]).toEqual(["2:120"]);
	});

	it("deletes ended and unreadable counters, keeps live ones and other keys, at most `max` per sweep", async () => {
		const { store, m, calls } = kvStore();
		for (const ip of ["a", "b", "c"]) await rateLimit(store, ip, 0, opts);
		m.set("rl:old:abc:1", "4");
		await rateLimit(store, "live", 200_000, opts);
		m.set("other:key", "1");
		calls.n = 0;
		expect(await sweepRateLimits(store, 200_000, 2)).toEqual({ calls: 3, more: true });
		expect(await sweepRateLimits(store, 200_000, 2)).toEqual({ calls: 3, more: false });
		expect([...m.values()].sort()).toEqual(["1", "1:240"]);
		expect(m.has("other:key")).toBe(true);
		expect(await sweepRateLimits(store, 200_000, 2)).toEqual({ calls: 1, more: false });
		expect(calls.n).toBe(7);
	});
});
