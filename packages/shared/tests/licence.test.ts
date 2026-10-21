/**
 * T070 licence keys (BUILD-PLAN §13, R17, D6). Every key pair here is generated at run time:
 * no private key is ever committed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	createLicenceVerifier,
	decodeBase64Url,
	encodeBase64Url,
	isExemptHost,
	LICENCE_MAX_LENGTH,
	LICENCE_MAX_SITES,
	type LicenceBuild,
	type LicencePayload,
	normaliseHostname,
	signLicence,
	validateLicencePayload,
} from "../src/index";

const utf8 = new TextEncoder();

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let publicKey: string;

async function generate(): Promise<CryptoKeyPair> {
	return (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
}

async function rawPublic(pair: CryptoKeyPair): Promise<string> {
	return encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
}

/** Signs arbitrary payload text the way `signLicence` does, to reach checks behind the signature. */
async function signRaw(payloadB64: string, pair: CryptoKeyPair = keys): Promise<string> {
	const sig = await crypto.subtle.sign("Ed25519", pair.privateKey, utf8.encode(`semics1.${payloadB64}`));
	return `semics1.${payloadB64}.${encodeBase64Url(new Uint8Array(sig))}`;
}

const payload = (overrides: Partial<Record<keyof LicencePayload, unknown>> = {}): LicencePayload =>
	({
		v: 1,
		product: "events",
		edition: "pro",
		sites: ["example.com"],
		customer: "cus_123",
		issuedAt: "2026-10-01",
		updatesUntil: "2027-10-01",
		...overrides,
	}) as LicencePayload;

const build = (overrides: Partial<LicenceBuild> = {}): LicenceBuild => ({
	publicKey,
	product: "events",
	buildDate: "2027-01-15",
	...overrides,
});

beforeAll(async () => {
	keys = await generate();
	otherKeys = await generate();
	publicKey = await rawPublic(keys);
});

describe("R17 licence verification: valid keys, hosts, tampering, products", () => {
	it("accepts a valid key on a listed site and returns the payload", async () => {
		const verify = createLicenceVerifier(build());
		const key = await signLicence(payload(), keys.privateKey);
		expect(key).toMatch(/^semics1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/);
		const result = await verify({ key, hostname: "example.com" });
		expect(result).toEqual({ ok: true, value: { kind: "licensed", hostname: "example.com", licence: payload() } });
		// The public key is imported once and reused.
		expect((await verify({ key, hostname: "EXAMPLE.com:443" })).ok).toBe(true);
	});

	it("tolerates surrounding whitespace from a pasted key and unknown future payload fields", async () => {
		const verify = createLicenceVerifier(build());
		const extra = encodeBase64Url(utf8.encode(JSON.stringify({ ...payload(), seats: 3 })));
		expect((await verify({ key: `  ${await signRaw(extra)}\n`, hostname: "example.com" })).ok).toBe(true);
	});

	it("rejects a key for another hostname", async () => {
		const verify = createLicenceVerifier(build());
		const key = await signLicence(payload(), keys.privateKey);
		expect(await verify({ key, hostname: "other.com" })).toEqual({ ok: false, error: "LICENCE_INVALID" });
		expect(await verify({ key, hostname: "www.example.com" })).toEqual({ ok: false, error: "LICENCE_INVALID" });
	});

	it("rejects a tampered payload or signature", async () => {
		const verify = createLicenceVerifier(build());
		const key = await signLicence(payload(), keys.privateKey);
		const [prefix, body, sig] = key.split(".") as [string, string, string];
		const forged = encodeBase64Url(utf8.encode(JSON.stringify(payload({ sites: ["other.com"] }))));
		expect(await verify({ key: `${prefix}.${forged}.${sig}`, hostname: "other.com" })).toEqual({
			ok: false,
			error: "LICENCE_INVALID",
		});
		const flipped = sig.startsWith("A") ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
		expect((await verify({ key: `${prefix}.${body}.${flipped}`, hostname: "example.com" })).ok).toBe(false);
	});

	it("rejects a key signed with any other private key", async () => {
		const verify = createLicenceVerifier(build());
		const key = await signLicence(payload(), otherKeys.privateKey);
		expect(await verify({ key, hostname: "example.com" })).toEqual({ ok: false, error: "LICENCE_INVALID" });
	});

	it("rejects a key for another product, and accepts a suite key for either product", async () => {
		const esignKey = await signLicence(payload({ product: "esign" }), keys.privateKey);
		const suiteKey = await signLicence(payload({ product: "suite" }), keys.privateKey);
		const events = createLicenceVerifier(build());
		const esign = createLicenceVerifier(build({ product: "esign" }));
		expect(await events({ key: esignKey, hostname: "example.com" })).toEqual({ ok: false, error: "LICENCE_INVALID" });
		expect((await esign({ key: esignKey, hostname: "example.com" })).ok).toBe(true);
		expect((await events({ key: suiteKey, hostname: "example.com" })).ok).toBe(true);
		expect((await esign({ key: suiteKey, hostname: "example.com" })).ok).toBe(true);
	});

	it("rejects missing, oversized and malformed keys", async () => {
		const verify = createLicenceVerifier(build());
		const valid = await signLicence(payload(), keys.privateKey);
		const [, body, sig] = valid.split(".") as [string, string, string];
		const bad = [
			undefined,
			null,
			"",
			"x".repeat(LICENCE_MAX_LENGTH + 1),
			`semics2.${body}.${sig}`,
			`semics1.${body}`,
			`semics1.${body}.${sig}.extra`,
			`semics1.${body}.${sig.slice(0, 40)}`, // valid base64url, but not 64 bytes
			`semics1.${body}.${sig.slice(0, -1)}!`, // not base64url
		];
		for (const key of bad) {
			expect(await verify({ key, hostname: "example.com" })).toEqual({ ok: false, error: "LICENCE_INVALID" });
		}
	});

	it("rejects a correctly signed key whose payload is not base64url, UTF-8, JSON or a valid payload", async () => {
		const verify = createLicenceVerifier(build());
		const enc = (text: string) => encodeBase64Url(utf8.encode(text));
		const bodies = [
			"a", // signed, but not canonical base64url
			encodeBase64Url(new Uint8Array([0xff, 0xfe])), // not UTF-8
			enc("{not json"),
			enc("[]"),
			enc(JSON.stringify(payload({ v: 2 }))),
		];
		for (const body of bodies) {
			expect(await verify({ key: await signRaw(body), hostname: "example.com" })).toEqual({
				ok: false,
				error: "LICENCE_INVALID",
			});
		}
	});

	it("rejects an unparseable hostname before touching the key", async () => {
		const verify = createLicenceVerifier(build());
		const key = await signLicence(payload(), keys.privateKey);
		expect(await verify({ key, hostname: "" })).toEqual({ ok: false, error: "LICENCE_INVALID" });
	});
});

describe("R17 updatesUntil: renewal for newer builds, perpetual fallback for older ones", () => {
	it("asks for renewal when the build is released after updatesUntil", async () => {
		const key = await signLicence(payload({ updatesUntil: "2027-10-01" }), keys.privateKey);
		const verify = createLicenceVerifier(build({ buildDate: "2027-10-02" }));
		expect(await verify({ key, hostname: "example.com" })).toEqual({ ok: false, error: "LICENCE_EXPIRED" });
	});

	it("keeps working for builds released on or before updatesUntil, however late it now is", async () => {
		const key = await signLicence(payload({ updatesUntil: "2027-10-01" }), keys.privateKey);
		for (const buildDate of ["2026-10-01", "2027-10-01"]) {
			expect((await createLicenceVerifier(build({ buildDate }))({ key, hostname: "example.com" })).ok).toBe(true);
		}
	});

	it("checks the host before the build date, so an expired key for another site is invalid", async () => {
		const key = await signLicence(payload(), keys.privateKey);
		const verify = createLicenceVerifier(build({ buildDate: "2030-01-01" }));
		expect(await verify({ key, hostname: "other.com" })).toEqual({ ok: false, error: "LICENCE_INVALID" });
	});
});

describe("R17 D6 local and preview hosts are exempt", () => {
	it("treats localhost and *.workers.dev as exempt without a key", async () => {
		const verify = createLicenceVerifier(build({ buildDate: "2030-01-01" }));
		for (const hostname of [
			"localhost",
			"localhost:4321",
			"app.localhost",
			"127.0.0.1:8787",
			"[::1]:4321",
			"my-site.semics.workers.dev",
			"preview.my-site.pages.dev",
		]) {
			const result = await verify({ key: undefined, hostname });
			expect(result.ok, hostname).toBe(true);
			expect(result.ok && result.value.kind).toBe("exempt");
		}
	});

	it("does not exempt look-alike hosts", () => {
		for (const host of [
			"workers.dev",
			"evilworkers.dev",
			"localhost.example.com",
			"workers.dev.example.com",
			"pages.dev",
		]) {
			expect(isExemptHost(host), host).toBe(false);
		}
		expect(isExemptHost("a.workers.dev")).toBe(true);
	});
});

describe("R17 hostname normalisation", () => {
	it("lower-cases, strips the port and a trailing dot", () => {
		expect(normaliseHostname("Example.COM:8443")).toBe("example.com");
		expect(normaliseHostname("example.com.")).toBe("example.com");
		expect(normaliseHostname("[::1]:80")).toBe("[::1]");
	});

	it("rejects anything that is not a bare host", () => {
		for (const host of [
			"",
			".",
			"exa mple.com",
			"user@example.com",
			"example.com/path",
			"example.com?x",
			"http://example.com",
			":80",
			"exémple.com",
		]) {
			expect(normaliseHostname(host), host).toBeUndefined();
		}
	});
});

describe("R17 licence payload schema", () => {
	it("accepts a valid payload", () => {
		expect(validateLicencePayload(payload())).toEqual(payload());
		expect(
			validateLicencePayload(
				payload({ sites: Array.from({ length: LICENCE_MAX_SITES }, (_, i) => `s${i}.example.com`) }),
			),
		).toBeDefined();
	});

	it("rejects each malformed field", () => {
		const bad: unknown[] = [
			null,
			"text",
			[payload()],
			payload({ v: 2 }),
			payload({ product: "other" }),
			payload({ edition: "free" }),
			payload({ sites: "example.com" }),
			payload({ sites: [] }),
			payload({ sites: Array.from({ length: LICENCE_MAX_SITES + 1 }, (_, i) => `s${i}.example.com`) }),
			payload({ sites: ["Example.com"] }), // must be stored normalised
			payload({ sites: [42] }),
			payload({ customer: "" }),
			payload({ customer: 7 }),
			payload({ customer: "c".repeat(201) }),
			payload({ issuedAt: "2026-02-30" }),
			payload({ issuedAt: "2026-13-01" }),
			payload({ issuedAt: 20261001 }),
			payload({ updatesUntil: "next year" }),
			payload({ issuedAt: "2027-10-02", updatesUntil: "2027-10-01" }),
		];
		for (const value of bad) expect(validateLicencePayload(value), JSON.stringify(value)).toBeUndefined();
	});

	it("refuses to sign an invalid payload", async () => {
		await expect(signLicence(payload({ sites: [] }), keys.privateKey)).rejects.toThrow(/payload/i);
	});
});

describe("R17 public key and build date are injected at build time", () => {
	it("refuses a public key that is not 32 raw Ed25519 bytes", () => {
		expect(() => createLicenceVerifier(build({ publicKey: "not base64!" }))).toThrow(/public key/i);
		expect(() => createLicenceVerifier(build({ publicKey: encodeBase64Url(new Uint8Array(31)) }))).toThrow(
			/public key/i,
		);
	});

	it("refuses an invalid build date or build product", () => {
		expect(() => createLicenceVerifier(build({ buildDate: "2027-1-1" }))).toThrow(/build date/i);
		expect(() => createLicenceVerifier(build({ product: "suite" as LicenceBuild["product"] }))).toThrow(/product/i);
	});

	it("uses only the injected key: a key signed by the site's own key pair never verifies", async () => {
		const verify = createLicenceVerifier(build());
		const own = await generate();
		const key = await signLicence(payload(), own.privateKey);
		expect((await verify({ key, hostname: "example.com" })).ok).toBe(false);
		expect(decodeBase64Url(publicKey)).toHaveLength(32);
	});
});
