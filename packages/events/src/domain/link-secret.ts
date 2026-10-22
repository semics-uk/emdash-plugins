import { LINK_SECRET_BYTES } from "@semics-tech/shared";

/**
 * The HMAC key for signed calendar links (`signLink`/`verifyLink`, purpose `events/booking-ics`):
 * 32 random bytes kept in KV as hex, created on first use with a create-only write. Reading it is
 * one bridge call; the first use adds a write (and a read if two requests race).
 */
export const LINK_KEY = "events:link-key";

export interface LinkKv {
	get<T>(key: string): Promise<T | null>;
	compareAndSet(key: string, expectedRevision: string | null, value: unknown): Promise<{ applied: boolean }>;
}

const KEY_HEX = new RegExp(`^[0-9a-f]{${LINK_SECRET_BYTES * 2}}$`);
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function decodeKey(value: unknown): Uint8Array | null {
	if (typeof value !== "string" || !KEY_HEX.test(value)) return null;
	return Uint8Array.from(value.match(/../g) as string[], (h) => Number.parseInt(h, 16));
}

export async function linkSecret(kv: LinkKv): Promise<Uint8Array> {
	const stored = decodeKey(await kv.get<string>(LINK_KEY));
	if (stored) return stored;
	const fresh = crypto.getRandomValues(new Uint8Array(LINK_SECRET_BYTES));
	if ((await kv.compareAndSet(LINK_KEY, null, toHex(fresh))).applied) return fresh;
	const winner = decodeKey(await kv.get<string>(LINK_KEY));
	if (!winner) throw new Error("calendar link key unavailable");
	return winner;
}
