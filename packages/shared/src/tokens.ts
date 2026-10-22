/**
 * Opaque tokens and short-lived signed links (BUILD-PLAN §3 access tokens, §4 `tokens.ts`).
 *
 * - `generateToken`: 32 random bytes as 43 unpadded base64url characters. Randomness is injectable.
 * - `hashToken`: lowercase hex SHA-256. Store only this, never the token.
 * - `verifyToken` / `constantTimeEqual`: compare without an early exit on the first differing byte.
 * - `signLink` / `verifyLink`: HMAC-SHA256 over a canonical form of purpose, expiry and parameters,
 *   for download and calendar URLs that must not carry the access token itself.
 *
 * Web Crypto only. Nothing here logs, and no error message includes token or secret material.
 */
import { encodeBase64Url, hmacSha256Key, type RandomBytes, toHex, webCryptoRandom } from "./bytes";
import { err, ok, type Result } from "./result";

/** Entropy of an opaque token: 256 bits. */
export const TOKEN_BYTES = 32;
/** Minimum HMAC key length for signed links. */
export const LINK_SECRET_BYTES = 32;
/** Default lifetime of a signed link: 15 minutes. */
export const DEFAULT_LINK_TTL_MS = 15 * 60 * 1000;
/** Longest lifetime a signed link may have: 1 hour. */
export const MAX_LINK_TTL_MS = 60 * 60 * 1000;
/** Shortest lifetime a signed link may have (expiry has whole-second resolution). */
export const MIN_LINK_TTL_MS = 1000;

export type { RandomBytes } from "./bytes";

const utf8 = new TextEncoder();
/** Domain separation for link signatures, distinct from every `esign-*` protocol prefix. */
const LINK_PREFIX = "semics-link/1";
const RESERVED = new Set(["exp", "sig"]);
const EXP_PATTERN = /^\d{1,15}$/;

/** A new 256-bit opaque token, URL-safe and unpadded (43 characters). */
export function generateToken(random: RandomBytes = webCryptoRandom): string {
	const bytes = random(TOKEN_BYTES);
	if (bytes.length !== TOKEN_BYTES) throw new Error(`Random source must return ${TOKEN_BYTES} bytes.`);
	return encodeBase64Url(bytes);
}

/** Lowercase hex SHA-256 of the token's UTF-8 bytes. Stable across runtimes. */
export async function hashToken(token: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(token)));
	return toHex(digest);
}

/**
 * Compares the UTF-8 bytes of two strings, touching every byte of the longer one and folding the
 * length difference into the result, so timing does not reveal where the inputs first differ.
 * (JavaScript gives no hard constant-time guarantee; this removes the data-dependent early exit.)
 */
export function constantTimeEqual(a: string, b: string): boolean {
	const x = utf8.encode(a);
	const y = utf8.encode(b);
	const length = Math.max(x.length, y.length);
	let diff = x.length ^ y.length;
	for (let i = 0; i < length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}

/**
 * True when `token` hashes to `storedHash` (as produced by `hashToken`). Without a stored hash (an
 * unknown record) the token is still hashed and compared, so the lookup's outcome does not show in
 * the timing (T100).
 */
export async function verifyToken(token: string, storedHash: string | null | undefined): Promise<boolean> {
	return constantTimeEqual(await hashToken(token), storedHash ?? "0".repeat(64));
}

export interface SignLinkInput {
	/** Raw HMAC key, at least 32 bytes. */
	secret: Uint8Array;
	/** What the link is for, e.g. `events/booking-ics`. A link never verifies for another purpose. */
	purpose: string;
	/** Values the link carries. The names `exp` and `sig` are reserved. */
	params: Record<string, string>;
	/** Current time in epoch milliseconds (injected). */
	now: number;
	/** Lifetime in milliseconds, 1 s to 1 h. Defaults to 15 minutes. */
	ttlMs?: number;
}

export interface VerifyLinkInput {
	secret: Uint8Array;
	purpose: string;
	/** The request's query, e.g. `new URL(request.url).searchParams`. */
	query: URLSearchParams;
	/** Current time in epoch milliseconds (injected). */
	now: number;
}

export type LinkError = "TOKEN_INVALID" | "TOKEN_EXPIRED";

async function linkKey(secret: Uint8Array): Promise<CryptoKey> {
	if (secret.length < LINK_SECRET_BYTES) throw new Error(`Link secret must be at least ${LINK_SECRET_BYTES} bytes.`);
	return hmacSha256Key(secret);
}

/** Every component is percent-encoded, so no name or value can shift a `=`, `&` or newline boundary. */
function canonical(purpose: string, exp: string, params: ReadonlyArray<readonly [string, string]>): string {
	const pairs = params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).sort();
	return [LINK_PREFIX, encodeURIComponent(purpose), exp, pairs.join("&")].join("\n");
}

async function mac(key: CryptoKey, message: string): Promise<string> {
	return encodeBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(message))));
}

/** Query parameters for a short-lived signed link: the given `params` plus `exp` (epoch s) and `sig`. */
export async function signLink(input: SignLinkInput): Promise<URLSearchParams> {
	const { secret, purpose, params, now, ttlMs = DEFAULT_LINK_TTL_MS } = input;
	const key = await linkKey(secret);
	if (purpose.length === 0) throw new Error("Link purpose must not be empty.");
	if (!Number.isFinite(now)) throw new Error("Link now must be a finite epoch time in milliseconds.");
	if (!(ttlMs >= MIN_LINK_TTL_MS && ttlMs <= MAX_LINK_TTL_MS)) {
		throw new Error(`Link ttl must be between ${MIN_LINK_TTL_MS} and ${MAX_LINK_TTL_MS} ms.`);
	}
	const entries = Object.entries(params);
	if (entries.some(([name]) => RESERVED.has(name)))
		throw new Error("Link params must not use the reserved names exp or sig.");
	const exp = String(Math.floor((now + ttlMs) / 1000));
	const query = new URLSearchParams(entries);
	query.set("exp", exp);
	query.set("sig", await mac(key, canonical(purpose, exp, entries)));
	return query;
}

/**
 * Checks a signed link. The signature is checked before the expiry, so a link whose `exp` was
 * edited reports `TOKEN_INVALID`, not `TOKEN_EXPIRED`. Duplicate names are rejected. On success,
 * returns the signed parameters without `exp` and `sig`.
 */
export async function verifyLink(input: VerifyLinkInput): Promise<Result<Record<string, string>, LinkError>> {
	const { secret, purpose, query, now } = input;
	const key = await linkKey(secret);
	const seen = new Set<string>();
	const params: Array<[string, string]> = [];
	let exp: string | undefined;
	let sig: string | undefined;
	for (const [name, value] of query) {
		if (seen.has(name)) return err("TOKEN_INVALID");
		seen.add(name);
		if (name === "exp") exp = value;
		else if (name === "sig") sig = value;
		else params.push([name, value]);
	}
	if (exp === undefined || sig === undefined || !EXP_PATTERN.test(exp)) return err("TOKEN_INVALID");
	if (!constantTimeEqual(await mac(key, canonical(purpose, exp, params)), sig)) return err("TOKEN_INVALID");
	if (now >= Number(exp) * 1000) return err("TOKEN_EXPIRED");
	return ok(Object.fromEntries(params));
}
