/**
 * Fixed-window rate limiter keyed by a salted hash of the client IP (raw IPs are never stored).
 * Storage is injected (KV-shaped). Cost: 2 calls when allowed (get + set), 1 when rejected.
 * Not atomic: concurrent requests can slightly exceed the limit, which is acceptable for abuse control.
 *
 * A counter is stored as `<count>:<window end, epoch seconds>` under `rl:<scope>:<ip hash>:<window>`.
 * EmDash KV has no TTL, so the cores' retention jobs delete ended windows with `sweepRateLimits`
 * (T100): otherwise every visitor's hashed IP would stay in KV for good. Any `rl:` key whose value
 * carries no end (or an end that has passed) is treated as ended.
 */
import { toHex } from "./bytes";
import { err, ok, type Result } from "./result";

export interface RateLimitStore {
	get(key: string): Promise<string | null | undefined>;
	set(key: string, value: string, options?: { ttlSeconds?: number }): Promise<void>;
}

export interface RateLimitOptions {
	/** Names the protected action, so limits are independent per route. */
	readonly scope: string;
	readonly limit: number;
	readonly windowSeconds: number;
	/** Salt so stored hashes cannot be reversed by enumerating the IPv4 space. */
	readonly salt: string;
}

/** First 128 bits of SHA-256(salt + ":" + ip), hex. */
export async function hashIp(ip: string, salt: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
	return toHex(new Uint8Array(digest).slice(0, 16));
}

export async function rateLimit(
	store: RateLimitStore,
	ip: string,
	nowMs: number,
	options: RateLimitOptions,
): Promise<Result<{ remaining: number }, "RATE_LIMITED">> {
	const window = Math.floor(nowMs / (options.windowSeconds * 1000));
	const key = `rl:${options.scope}:${await hashIp(ip, options.salt)}:${window}`;
	const parsed = Number.parseInt((await store.get(key)) ?? "0", 10);
	const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	if (count >= options.limit) return err("RATE_LIMITED");
	await store.set(key, `${count + 1}:${(window + 1) * options.windowSeconds}`, { ttlSeconds: options.windowSeconds * 2 });
	return ok({ remaining: options.limit - count - 1 });
}

export interface RateLimitSweepStore {
	list(prefix: string): Promise<Array<{ key: string; value: unknown }>>;
	delete(key: string): Promise<unknown>;
}

/** Deletes up to `max` ended `rl:` counters: 1 call for the list plus one per delete. */
export async function sweepRateLimits(
	store: RateLimitSweepStore,
	nowMs: number,
	max: number,
): Promise<{ calls: number; more: boolean }> {
	const ended = (await store.list("rl:"))
		.filter(({ value }) => !(Number(String(value).split(":")[1]) * 1000 > nowMs))
		.map(({ key }) => key);
	for (const key of ended.slice(0, max)) await store.delete(key);
	return { calls: 1 + Math.min(max, ended.length), more: ended.length > max };
}
