import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CLIENT_SECRET_BYTES,
	deriveClientSecret,
	encodeBase64Url,
	formatPairing,
	generateClientId,
	parsePairing,
} from "../src/index";

interface PairingVector {
	name: string;
	type: string;
	input: { pairing: string };
	expected: { ok: true; clientId: string; secret: string } | { ok: false; error: string };
}

const vectors: PairingVector[] = JSON.parse(
	readFileSync(new URL("../../../docs/protocol/vectors.json", import.meta.url), "utf8"),
).vectors.filter((v: PairingVector) => v.type === "pairing");

const outcome = (r: ReturnType<typeof parsePairing>) =>
	r.ok ? { ok: true, clientId: r.value.clientId, secret: encodeBase64Url(r.value.secret) } : { ok: false, error: r.error };

describe("SX-NFR-01 pairing string vectors", () => {
	it("has the 9 pairing vectors", () => expect(vectors).toHaveLength(9));

	it.each(vectors.map((v) => [v.name, v] as const))("%s produces its expected outcome", (_name, v) => {
		expect(outcome(parsePairing(v.input.pairing))).toEqual(v.expected);
	});
});

describe("SX-NFR-02 pairing string parsing", () => {
	const secret = encodeBase64Url(Uint8Array.from({ length: 32 }, (_, i) => i));

	it("rejects malformed strings and short or long secrets", () => {
		for (const bad of [
			"",
			`esign1.cl_x.${secret}`, // client id under 4 characters
			`esign1.${"c".repeat(65)}.${secret}`,
			`esign1.cl_test.${secret.slice(0, 42)}`,
			`esign1.cl_test.${secret}A`,
			`esign1.cl_test.${encodeBase64Url(new Uint8Array(31))}`,
			`esign1.cl_test.${encodeBase64Url(new Uint8Array(33))}`,
			`ESIGN1.cl_test.${secret}`,
			`esign1.cl_test.${secret}\n`,
			`esign1.cl_tést.${secret}`,
		]) {
			expect([bad, parsePairing(bad).ok]).toEqual([bad, false]);
		}
		expect(parsePairing(42 as unknown as string)).toEqual({ ok: false, error: "PAIRING_MALFORMED" });
	});

	it("formats and parses back to the same client id and secret", () => {
		const bytes = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
		const pairing = formatPairing("cl_abcdefghijklmnop", bytes);
		expect(pairing).toBe(`esign1.cl_abcdefghijklmnop.${encodeBase64Url(bytes)}`);
		const parsed = parsePairing(pairing);
		expect(parsed.ok && parsed.value).toEqual({ clientId: "cl_abcdefghijklmnop", secret: bytes });
	});

	it("refuses to format a bad client id or secret", () => {
		expect(() => formatPairing("no", new Uint8Array(32))).toThrow(/client id/i);
		expect(() => formatPairing("cl_test", new Uint8Array(16))).toThrow(/32 bytes/);
	});
});

describe("SX-NFR-02 client secret derivation (Spike S8)", () => {
	const master = Uint8Array.from({ length: 32 }, (_, i) => i * 3);

	it("is HMAC-SHA256(masterKey, 'esign-client/1.' + clientId)", async () => {
		const expected = createHmac("sha256", master).update("esign-client/1.cl_abcdefghijklmnop").digest();
		const derived = await deriveClientSecret(master, "cl_abcdefghijklmnop");
		expect(derived).toHaveLength(CLIENT_SECRET_BYTES);
		expect(Buffer.from(derived).equals(expected)).toBe(true);
	});

	it("gives each client its own secret, and a pairing string that parses", async () => {
		const a = await deriveClientSecret(master, "cl_aaaaaaaaaaaaaaaa");
		const b = await deriveClientSecret(master, "cl_bbbbbbbbbbbbbbbb");
		expect(encodeBase64Url(a)).not.toBe(encodeBase64Url(b));
		expect(parsePairing(formatPairing("cl_aaaaaaaaaaaaaaaa", a)).ok).toBe(true);
	});

	it("requires a master key of at least 32 bytes and a valid client id", async () => {
		await expect(deriveClientSecret(new Uint8Array(31), "cl_test")).rejects.toThrow(/32 bytes/);
		await expect(deriveClientSecret(master, "bad id")).rejects.toThrow(/client id/i);
	});
});

describe("SX-NFR-02 client id generation", () => {
	it("is cl_ plus 16 lowercase base32 characters", () => {
		const ids = new Set(Array.from({ length: 20 }, () => generateClientId()));
		expect(ids.size).toBe(20);
		for (const id of ids) expect(id).toMatch(/^cl_[a-z2-7]{16}$/);
	});

	it("maps injected randomness through the base32 alphabet", () => {
		expect(generateClientId((n) => Uint8Array.from({ length: n }, (_, i) => i * 2 + 32))).toBe("cl_acegikmoqsuwy246");
		expect(() => generateClientId(() => new Uint8Array(3))).toThrow(/16 bytes/);
	});
});
