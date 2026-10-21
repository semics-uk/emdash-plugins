import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	constantTimeEqual,
	generateToken,
	hashToken,
	MAX_LINK_TTL_MS,
	signLink,
	TOKEN_BYTES,
	verifyLink,
	verifyToken,
} from "../src/index";

const SECRET = new Uint8Array(32).fill(7);
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const fixedBytes = (byte: number) => (length: number) => new Uint8Array(length).fill(byte);

describe("EV-FR-07 ES-NFR-02 opaque tokens", () => {
	it("is 43 base64url characters from 32 random bytes", () => {
		const requested: number[] = [];
		const token = generateToken((length) => {
			requested.push(length);
			return new Uint8Array(length).fill(0xff);
		});
		expect(requested).toEqual([32]);
		expect(TOKEN_BYTES).toBe(32);
		expect(token).toHaveLength(43);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// 32 bytes of 0xff in base64url, unpadded: every 6-bit group is 63 ("_") except the last.
		expect(token).toBe(`${"_".repeat(42)}w`);
	});

	it("uses Web Crypto randomness by default and never repeats", () => {
		const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
		expect(tokens.size).toBe(50);
		for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("maps every byte value to the URL-safe alphabet", () => {
		let next = 0;
		const counting = (length: number) => Uint8Array.from({ length }, () => next++ % 256);
		const chars = new Set<string>();
		for (let i = 0; i < 8; i++) for (const c of generateToken(counting)) chars.add(c);
		expect(chars.has("-")).toBe(true);
		expect(chars.has("_")).toBe(true);
		expect([...chars].join("")).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("rejects an injected random source that returns the wrong number of bytes", () => {
		expect(() => generateToken(() => new Uint8Array(31))).toThrow(/32 bytes/);
	});
});

describe("EV-FR-07 ES-NFR-02 token hashing", () => {
	it("is stable, lowercase hex SHA-256", async () => {
		// SHA-256("abc"), FIPS 180-2 test vector.
		expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		const token = generateToken(fixedBytes(1));
		const first = await hashToken(token);
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(await hashToken(token)).toBe(first);
		expect(await hashToken(generateToken(fixedBytes(2)))).not.toBe(first);
	});

	it("verifies a presented token against its stored hash", async () => {
		const token = generateToken();
		const stored = await hashToken(token);
		expect(await verifyToken(token, stored)).toBe(true);
		expect(await verifyToken(generateToken(), stored)).toBe(false);
		expect(await verifyToken(token, stored.toUpperCase())).toBe(false);
		expect(await verifyToken(token, "")).toBe(false);
	});
});

describe("ES-NFR-02 constant-time compare", () => {
	it("returns true only for identical inputs", () => {
		expect(constantTimeEqual("same-value", "same-value")).toBe(true);
		expect(constantTimeEqual("", "")).toBe(true);
	});

	it("returns false for equal-length different inputs", () => {
		expect(constantTimeEqual("abcdef", "abcdeg")).toBe(false);
		expect(constantTimeEqual("Xbcdef", "abcdef")).toBe(false);
	});

	it("returns false for different lengths, either way round", () => {
		expect(constantTimeEqual("abc", "abcd")).toBe(false);
		expect(constantTimeEqual("abcd", "abc")).toBe(false);
		expect(constantTimeEqual("", "a")).toBe(false);
		// A prefix padded with NULs must not collide with the shorter input.
		expect(constantTimeEqual("abc", "abc\u0000")).toBe(false);
	});

	it("compares UTF-8 bytes, not UTF-16 code units", () => {
		expect(constantTimeEqual("é", "é")).toBe(true);
		expect(constantTimeEqual("é", "é")).toBe(false);
	});
});

describe("EV-FR-07 ES-NFR-02 short-lived signed links", () => {
	const purpose = "events/booking-ics";
	const params = { b: "BK-1234", o: "occ 1&2=3" };

	async function link(overrides: { ttlMs?: number } = {}) {
		return signLink({ secret: SECRET, purpose, params, now: NOW, ...overrides });
	}

	it("verifies before expiry and returns the signed parameters", async () => {
		const query = await link({ ttlMs: 60_000 });
		expect(query.get("exp")).toBe(String(NOW / 1000 + 60));
		expect(query.get("sig")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const result = await verifyLink({ secret: SECRET, purpose, query, now: NOW + 59_999 });
		expect(result).toEqual({ ok: true, value: params });
	});

	it("survives a round trip through a URL", async () => {
		const query = await link();
		const url = new URL(`https://example.com/_emdash/api/plugins/events/public/booking/ics?${query}`);
		const result = await verifyLink({ secret: SECRET, purpose, query: url.searchParams, now: NOW });
		expect(result).toEqual({ ok: true, value: params });
	});

	it("fails at and after expiry", async () => {
		const query = await link({ ttlMs: 60_000 });
		for (const now of [NOW + 60_000, NOW + 3_600_000]) {
			expect(await verifyLink({ secret: SECRET, purpose, query, now })).toEqual({ ok: false, error: "TOKEN_EXPIRED" });
		}
	});

	it("rounds the expiry down so a link never outlives its ttl", async () => {
		const query = await signLink({ secret: SECRET, purpose, params, now: NOW + 999, ttlMs: 1_500 });
		expect(query.get("exp")).toBe(String(NOW / 1000 + 2));
	});

	it("defaults to a 15 minute lifetime", async () => {
		const query = await link();
		expect(query.get("exp")).toBe(String(NOW / 1000 + 900));
	});

	it("fails when any parameter is changed, added or removed", async () => {
		const query = await link();
		const tampered: Array<(q: URLSearchParams) => void> = [
			(q) => q.set("b", "BK-1235"),
			(q) => q.set("o", "occ 1&2=4"),
			(q) => q.delete("o"),
			(q) => q.set("extra", "1"),
			(q) => q.set("exp", String(Number(q.get("exp")) + 1)),
			(q) => q.set("sig", `${(q.get("sig") as string).slice(0, -1)}A`),
			(q) => q.append("b", "BK-1234"),
		];
		for (const tamper of tampered) {
			const copy = new URLSearchParams(query);
			tamper(copy);
			expect(await verifyLink({ secret: SECRET, purpose, query: copy, now: NOW })).toEqual({
				ok: false,
				error: "TOKEN_INVALID",
			});
		}
	});

	it("fails for another purpose or another secret", async () => {
		const query = await link();
		const other = { secret: SECRET, purpose: "esign/download", query, now: NOW };
		expect(await verifyLink(other)).toEqual({ ok: false, error: "TOKEN_INVALID" });
		const wrongKey = { secret: new Uint8Array(32).fill(8), purpose, query, now: NOW };
		expect(await verifyLink(wrongKey)).toEqual({ ok: false, error: "TOKEN_INVALID" });
	});

	it("fails when exp or sig is missing or malformed", async () => {
		const query = await link();
		const broken: Array<(q: URLSearchParams) => void> = [
			(q) => q.delete("exp"),
			(q) => q.delete("sig"),
			(q) => q.set("exp", "1e12"),
			(q) => q.set("exp", ""),
			(q) => q.set("exp", "-5"),
		];
		for (const breakIt of broken) {
			const copy = new URLSearchParams(query);
			breakIt(copy);
			expect(await verifyLink({ secret: SECRET, purpose, query: copy, now: NOW })).toEqual({
				ok: false,
				error: "TOKEN_INVALID",
			});
		}
	});

	it("does not let parameter boundaries be shifted between names and values", async () => {
		const a = await signLink({ secret: SECRET, purpose, params: { a: "1&b=2" }, now: NOW });
		const forged = new URLSearchParams({ a: "1", b: "2", exp: a.get("exp") as string, sig: a.get("sig") as string });
		expect(await verifyLink({ secret: SECRET, purpose, query: forged, now: NOW })).toEqual({
			ok: false,
			error: "TOKEN_INVALID",
		});
	});

	it("signs parameters independently of their order", async () => {
		const one = await signLink({ secret: SECRET, purpose, params: { a: "1", b: "2" }, now: NOW });
		const two = await signLink({ secret: SECRET, purpose, params: { b: "2", a: "1" }, now: NOW });
		expect(one.get("sig")).toBe(two.get("sig"));
	});

	it("refuses unsafe inputs when signing", async () => {
		const base = { secret: SECRET, purpose, params, now: NOW };
		await expect(signLink({ ...base, secret: new Uint8Array(31) })).rejects.toThrow(/32 bytes/);
		await expect(signLink({ ...base, purpose: "" })).rejects.toThrow(/purpose/);
		await expect(signLink({ ...base, params: { exp: "1" } })).rejects.toThrow(/reserved/);
		await expect(signLink({ ...base, params: { sig: "1" } })).rejects.toThrow(/reserved/);
		await expect(signLink({ ...base, ttlMs: 0 })).rejects.toThrow(/ttl/);
		await expect(signLink({ ...base, ttlMs: 999 })).rejects.toThrow(/ttl/);
		await expect(signLink({ ...base, ttlMs: Number.NaN })).rejects.toThrow(/ttl/);
		await expect(signLink({ ...base, ttlMs: MAX_LINK_TTL_MS + 1 })).rejects.toThrow(/ttl/);
		await expect(signLink({ ...base, now: Number.NaN })).rejects.toThrow(/now/);
		await expect(signLink({ ...base, ttlMs: MAX_LINK_TTL_MS })).resolves.toBeInstanceOf(URLSearchParams);
	});

	it("fails closed when verifying with a short secret", async () => {
		const query = await link();
		await expect(verifyLink({ secret: new Uint8Array(16), purpose, query, now: NOW })).rejects.toThrow(/32 bytes/);
	});
});

describe("ES-NFR-02 tokens are never logged", () => {
	afterEach(() => vi.restoreAllMocks());

	it("has no console or logger calls in the tokens module", () => {
		const source = readFileSync(new URL("../src/tokens.ts", import.meta.url), "utf8");
		expect(source).not.toMatch(/\bconsole\s*\./);
		expect(source).not.toMatch(/\.(log|info|warn|error|debug|trace)\s*\(/);
	});

	it("writes nothing to the console while issuing and checking tokens and links", async () => {
		const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((m) =>
			vi.spyOn(console, m).mockImplementation(() => {}),
		);
		const token = generateToken();
		await verifyToken(token, await hashToken(token));
		const query = await signLink({ secret: SECRET, purpose: "p", params: { t: token }, now: NOW });
		await verifyLink({ secret: SECRET, purpose: "p", query, now: NOW });
		await verifyLink({ secret: SECRET, purpose: "p", query: new URLSearchParams(), now: NOW });
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
	});

	it("keeps token material out of error messages", async () => {
		const token = generateToken();
		const thrown = await signLink({ secret: SECRET, purpose: "p", params: { t: token, exp: token }, now: NOW }).catch(
			(e: unknown) => e as Error,
		);
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toContain(token);
	});
});
