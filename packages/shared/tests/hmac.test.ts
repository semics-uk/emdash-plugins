import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	decodeBase64Url,
	ESIGN_MAX_TOKEN_LENGTH,
	ESIGN_PREFIXES,
	type EsignClient,
	type EsignTokenType,
	encodeBase64Url,
	isReturnUrlAllowed,
	type IntentPayload,
	type ReceiptPayload,
	signEsignToken,
	validateEsignPayload,
	verifyCatalogToken,
	verifyIntentToken,
	verifyLookupToken,
	verifyReceiptToken,
} from "../src/index";

// --- vectors.json (docs/protocol, generated; never edited by hand) ---

interface VectorClient {
	secret: string;
	revoked: boolean;
	returnUrlAllowlist?: string[];
}
interface TokenVector {
	name: string;
	type: EsignTokenType;
	description: string;
	input: {
		token: string;
		expectedPrefix: string;
		signedWithPrefix?: string;
		signedWithSecret?: string;
		payload?: unknown;
		tamper?: string;
	};
	verifier: { now: number; clients: Record<string, VectorClient>; usedNonces: Array<{ cid: string; nonce: string }> };
	expected: { ok: true; payload: unknown } | { ok: false; error: string };
}
interface VectorFile {
	constants: {
		prefixes: Record<EsignTokenType, string>;
		maxTokenLength: Record<EsignTokenType, number>;
	};
	keys: Record<"A" | "B" | "R", { cid: string; secret: string; pairing: string }>;
	vectors: Array<TokenVector | { name: string; type: "pairing" }>;
}

const file: VectorFile = JSON.parse(
	readFileSync(new URL("../../../docs/protocol/vectors.json", import.meta.url), "utf8"),
);
const tokenVectors = file.vectors.filter((v): v is TokenVector => v.type !== "pairing");
const KEY_A = file.keys.A;
const KEY_B = file.keys.B;
const bytes = (b64: string) => decodeBase64Url(b64) as Uint8Array;
const SITE_ORIGIN = "https://esign.example";
const NOW_S = 1_800_000_000;
const NOW = NOW_S * 1000;

/** A nonce store with put-if-absent semantics, seeded with already-consumed pairs. */
function nonceStore(used: Array<{ cid: string; nonce: string }> = []) {
	const consumed = new Map<string, number>(used.map(({ cid, nonce }) => [`${cid}:${nonce}`, 0]));
	const calls: Array<[string, string, number]> = [];
	return {
		consumed,
		calls,
		consume: (cid: string, nonce: string, expiresAt: number) => {
			calls.push([cid, nonce, expiresAt]);
			const id = `${cid}:${nonce}`;
			if (consumed.has(id)) return false;
			consumed.set(id, expiresAt);
			return true;
		},
	};
}

function clientTable(clients: Record<string, VectorClient>) {
	return (cid: string): EsignClient | undefined => {
		if (!Object.hasOwn(clients, cid)) return undefined;
		const c = clients[cid] as VectorClient;
		return { secret: bytes(c.secret), revoked: c.revoked, returnUrlAllowlist: c.returnUrlAllowlist };
	};
}

async function runVector(v: TokenVector) {
	const base = { token: v.input.token, now: v.verifier.now * 1000, getClient: clientTable(v.verifier.clients) };
	switch (v.type) {
		case "intent":
			return verifyIntentToken({
				...base,
				consumeNonce: nonceStore(v.verifier.usedNonces).consume,
				siteOrigin: SITE_ORIGIN,
			});
		case "receipt":
			return verifyReceiptToken(base);
		case "lookup":
			return verifyLookupToken(base);
		case "catalog":
			return verifyCatalogToken(base);
	}
}

const outcome = (r: Awaited<ReturnType<typeof runVector>>) =>
	r.ok ? { ok: true, payload: r.value } : { ok: false, error: r.error };

describe("SX-NFR-01 SX-NFR-02 esign-intent/1 vectors", () => {
	it("has the 93 token vectors and constants the spec defines", () => {
		expect(tokenVectors).toHaveLength(93);
		expect(ESIGN_PREFIXES).toEqual(file.constants.prefixes);
		expect(ESIGN_MAX_TOKEN_LENGTH).toEqual(file.constants.maxTokenLength);
	});

	it.each(tokenVectors.map((v) => [v.name, v] as const))("%s produces its expected outcome", async (_name, v) => {
		expect(outcome(await runVector(v))).toEqual(v.expected);
	});

	const reproducible = tokenVectors.filter(
		(v) =>
			v.input.tamper === undefined &&
			v.input.signedWithPrefix === v.input.expectedPrefix &&
			v.input.signedWithSecret !== undefined &&
			validateEsignPayload(v.type, v.input.payload).ok,
	);

	it("has signable vectors of every type", () => {
		expect(new Set(reproducible.map((v) => v.type))).toEqual(new Set(["intent", "receipt", "lookup", "catalog"]));
	});

	it.each(reproducible.map((v) => [v.name, v] as const))("%s is reproduced byte for byte by the issuer", async (_n, v) => {
		const token = await signEsignToken(
			v.type,
			v.input.payload as IntentPayload,
			bytes(v.input.signedWithSecret as string),
		);
		expect(token).toBe(v.input.token);
	});
});

// --- fixtures for targeted tests ---

const intentPayload = (over: Record<string, unknown> = {}): IntentPayload =>
	({
		v: 1,
		typ: "intent",
		cid: KEY_A.cid,
		iat: NOW_S - 60,
		exp: NOW_S + 900,
		nonce: "n0nce-ZZZZZZZZZZZZZZZZ",
		tpl: "tpl_waiver",
		ref: "BK7Q2M:ATT01",
		signer: { name: "Alex Example", email: "alex@example.com" },
		prefill: {},
		returnUrl: "https://events.example/booking/BK7Q2M",
		...over,
	}) as IntentPayload;

const receiptPayload = (over: Record<string, unknown> = {}): ReceiptPayload =>
	({
		v: 1,
		typ: "receipt",
		cid: KEY_A.cid,
		envelopeId: "env_1",
		ref: "BK7Q2M:ATT01",
		status: "completed",
		docSha256: "a".repeat(64),
		pdfSha256: "b".repeat(64),
		finalHash: "c".repeat(64),
		at: NOW_S - 10,
		...over,
	}) as ReceiptPayload;

const ALLOWLIST = ["https://events.example/booking", "https://events.example/sign/"];
const clientsA = (over: Partial<EsignClient> = {}) => {
	const table: Record<string, EsignClient> = {
		[KEY_A.cid]: { secret: bytes(KEY_A.secret), revoked: false, returnUrlAllowlist: ALLOWLIST, ...over },
	};
	return (cid: string) => table[cid];
};

/** Mints a token with raw HMAC, bypassing the issuer's schema checks. */
async function rawSign(prefix: string, payload: unknown, secret = bytes(KEY_A.secret)): Promise<string> {
	const payloadB64 = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
	return rawSignSegment(prefix, payloadB64, secret);
}

async function rawSignSegment(prefix: string, payloadB64: string, secret = bytes(KEY_A.secret)): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new Uint8Array(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	const sig = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${prefix}.${payloadB64}`)),
	);
	return `${payloadB64}.${encodeBase64Url(sig)}`;
}

async function verifyIntent(token: unknown, over: Partial<Parameters<typeof verifyIntentToken>[0]> = {}) {
	const store = nonceStore();
	const result = await verifyIntentToken({
		token,
		now: NOW,
		getClient: clientsA(),
		consumeNonce: store.consume,
		siteOrigin: SITE_ORIGIN,
		...over,
	});
	return { result, store };
}

const errorOf = (r: { ok: boolean; error?: unknown }) => (r.ok ? "ok" : r.error);

describe("SX-NFR-02 prefix confusion", () => {
	it("a receipt token never verifies as an intent, even with intent-shaped fields", async () => {
		// Intent payload, typ forced to "intent", but minted by the receipt issuer prefix.
		const token = await rawSign(ESIGN_PREFIXES.receipt, intentPayload());
		expect(errorOf((await verifyIntent(token)).result)).toBe("TOKEN_INVALID");
		const genuine = await signEsignToken("receipt", receiptPayload(), bytes(KEY_A.secret));
		expect(errorOf((await verifyIntent(genuine)).result)).toBe("TOKEN_INVALID");
	});

	it("each type's token fails every other type's verifier with TOKEN_INVALID", async () => {
		const secret = bytes(KEY_A.secret);
		const tokens: Record<EsignTokenType, string> = {
			intent: await signEsignToken("intent", intentPayload(), secret),
			receipt: await signEsignToken("receipt", receiptPayload(), secret),
			lookup: await signEsignToken("lookup", { v: 1, typ: "lookup", cid: KEY_A.cid, ts: NOW_S, ref: "BK7Q2M" }, secret),
			catalog: await signEsignToken("catalog", { v: 1, typ: "catalog", cid: KEY_A.cid, ts: NOW_S }, secret),
		};
		const base = { now: NOW, getClient: clientsA() };
		const verifiers: Record<EsignTokenType, (token: string) => Promise<{ ok: boolean; error?: unknown }>> = {
			intent: (token) => verifyIntentToken({ ...base, token, consumeNonce: nonceStore().consume }),
			receipt: (token) => verifyReceiptToken({ ...base, token }),
			lookup: (token) => verifyLookupToken({ ...base, token }),
			catalog: (token) => verifyCatalogToken({ ...base, token }),
		};
		for (const expected of Object.keys(verifiers) as EsignTokenType[]) {
			for (const presented of Object.keys(tokens) as EsignTokenType[]) {
				const r = await verifiers[expected](tokens[presented]);
				expect([expected, presented, errorOf(r)]).toEqual([
					expected,
					presented,
					expected === presented ? "ok" : "TOKEN_INVALID",
				]);
			}
		}
	});
});

describe("SX-NFR-02 expiry and tampering", () => {
	it("an expired intent fails with TOKEN_EXPIRED and does not burn its nonce", async () => {
		const token = await signEsignToken("intent", intentPayload({ iat: NOW_S - 1000, exp: NOW_S - 61 }), bytes(KEY_A.secret));
		const { result, store } = await verifyIntent(token);
		expect(errorOf(result)).toBe("TOKEN_EXPIRED");
		expect(store.calls).toEqual([]);
	});

	it("expired lookup and catalog requests fail with TOKEN_EXPIRED", async () => {
		const secret = bytes(KEY_A.secret);
		const lookup = await signEsignToken("lookup", { v: 1, typ: "lookup", cid: KEY_A.cid, ts: NOW_S - 361, ref: "R" }, secret);
		const catalog = await signEsignToken("catalog", { v: 1, typ: "catalog", cid: KEY_A.cid, ts: NOW_S - 361 }, secret);
		expect(errorOf(await verifyLookupToken({ token: lookup, now: NOW, getClient: clientsA() }))).toBe("TOKEN_EXPIRED");
		expect(errorOf(await verifyCatalogToken({ token: catalog, now: NOW, getClient: clientsA() }))).toBe("TOKEN_EXPIRED");
	});

	it("truncates the injected millisecond clock to whole seconds", async () => {
		const token = await signEsignToken("intent", intentPayload({ iat: NOW_S - 1000, exp: NOW_S - 60 }), bytes(KEY_A.secret));
		expect(errorOf((await verifyIntent(token, { now: NOW + 999 })).result)).toBe("ok");
		expect(errorOf((await verifyIntent(token, { now: NOW + 1000 })).result)).toBe("TOKEN_EXPIRED");
	});

	it("a tampered payload or signature fails with TOKEN_INVALID", async () => {
		const token = await signEsignToken("intent", intentPayload(), bytes(KEY_A.secret));
		const [payloadB64, sig] = token.split(".") as [string, string];
		const json = new TextDecoder().decode(decodeBase64Url(payloadB64));
		const forged = encodeBase64Url(new TextEncoder().encode(json.replace("alex@", "mallory@")));
		expect(errorOf((await verifyIntent(`${forged}.${sig}`)).result)).toBe("TOKEN_INVALID");
		const flipped = `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
		expect(errorOf((await verifyIntent(`${payloadB64}.${flipped}`)).result)).toBe("TOKEN_INVALID");
		const other = await signEsignToken("intent", intentPayload(), bytes(KEY_B.secret));
		expect(errorOf((await verifyIntent(other)).result)).toBe("TOKEN_INVALID");
	});

	it("a tampered receipt fails with TOKEN_INVALID", async () => {
		const token = await signEsignToken("receipt", receiptPayload(), bytes(KEY_A.secret));
		const [, sig] = token.split(".");
		const forged = await rawSign("ignored", receiptPayload({ ref: "BK7Q2M:ATT02" }));
		const tampered = `${forged.split(".")[0]}.${sig}`;
		expect(errorOf(await verifyReceiptToken({ token: tampered, now: NOW, getClient: clientsA() }))).toBe("TOKEN_INVALID");
	});
});

describe("SX-NFR-02 verification order and structure", () => {
	it("rejects non-string tokens as malformed", async () => {
		for (const token of [undefined, null, 42, {}, ["a.b"]]) {
			expect(errorOf((await verifyIntent(token)).result)).toBe("TOKEN_MALFORMED");
		}
	});

	it("checks size before decoding anything", async () => {
		const getClient = () => {
			throw new Error("must not look up a client");
		};
		const r = await verifyIntent("!".repeat(ESIGN_MAX_TOKEN_LENGTH.intent + 1), { getClient });
		expect(errorOf(r.result)).toBe("TOKEN_TOO_LARGE");
	});

	it("rejects a byte-order mark, a non-string cid and a cid outside the grammar", async () => {
		const bom = encodeBase64Url(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(JSON.stringify(intentPayload()))]));
		expect(errorOf((await verifyIntent(await rawSignSegment(ESIGN_PREFIXES.intent, bom))).result)).toBe("TOKEN_MALFORMED");
		for (const cid of [42, "abc", "a".repeat(65), "cl test", null]) {
			const token = await rawSign(ESIGN_PREFIXES.intent, intentPayload({ cid }));
			expect([cid, errorOf((await verifyIntent(token)).result)]).toEqual([cid, "TOKEN_MALFORMED"]);
		}
		const nullPayload = await rawSign(ESIGN_PREFIXES.intent, null);
		expect(errorOf((await verifyIntent(nullPayload)).result)).toBe("TOKEN_MALFORMED");
	});

	it("accepts async client lookups and async nonce stores", async () => {
		const token = await signEsignToken("intent", intentPayload(), bytes(KEY_A.secret));
		const lookup = clientsA();
		const r = await verifyIntentToken({
			token,
			now: NOW,
			getClient: async (cid) => lookup(cid),
			consumeNonce: async () => true,
		});
		expect(errorOf(r)).toBe("ok");
	});

	it("records the nonce once with expiresAt = exp + 60, and reports a lost race as TOKEN_REPLAYED", async () => {
		const payload = intentPayload();
		const token = await signEsignToken("intent", payload, bytes(KEY_A.secret));
		const store = nonceStore();
		const input = { token, now: NOW, getClient: clientsA(), consumeNonce: store.consume, siteOrigin: SITE_ORIGIN };
		expect(errorOf(await verifyIntentToken(input))).toBe("ok");
		expect(store.calls).toEqual([[KEY_A.cid, payload.nonce, payload.exp + 60]]);
		expect(errorOf(await verifyIntentToken(input))).toBe("TOKEN_REPLAYED");
		const lostRace = await verifyIntentToken({ ...input, consumeNonce: () => false });
		expect(errorOf(lostRace)).toBe("TOKEN_REPLAYED");
	});

	it("checks the return URL before consuming the nonce", async () => {
		const token = await signEsignToken("intent", intentPayload({ returnUrl: "https://evil.example/" }), bytes(KEY_A.secret));
		const { result, store } = await verifyIntent(token);
		expect(errorOf(result)).toBe("RETURN_URL_NOT_ALLOWED");
		expect(store.calls).toEqual([]);
	});

	it("falls back to the e-sign site's origin when a client has no allowlist, and fails closed without one", async () => {
		const sameOrigin = await signEsignToken("intent", intentPayload({ returnUrl: `${SITE_ORIGIN}/done` }), bytes(KEY_A.secret));
		const noList = { getClient: clientsA({ returnUrlAllowlist: undefined }) };
		expect(errorOf((await verifyIntent(sameOrigin, noList)).result)).toBe("ok");
		const emptyList = { getClient: clientsA({ returnUrlAllowlist: [] }) };
		expect(errorOf((await verifyIntent(sameOrigin, emptyList)).result)).toBe("ok");
		expect(errorOf((await verifyIntent(sameOrigin, { ...noList, siteOrigin: undefined })).result)).toBe(
			"RETURN_URL_NOT_ALLOWED",
		);
	});
});

describe("SX-NFR-02 intent schema", () => {
	const invalid: Array<[string, Record<string, unknown>]> = [
		["v missing", { v: undefined }],
		["v string", { v: "1" }],
		["typ wrong", { typ: "lookup" }],
		["iat negative", { iat: -1 }],
		["iat unsafe", { iat: 2 ** 53 }],
		["iat string", { iat: "1" }],
		["exp fraction", { exp: NOW_S + 0.5 }],
		["exp before iat", { exp: NOW_S - 61 }],
		["nonce long", { nonce: "n".repeat(65) }],
		["nonce bad char", { nonce: "n0nce+AAAAAAAAAAAAAAA" }],
		["nonce number", { nonce: 1234567890123456 }],
		["tpl empty", { tpl: "" }],
		["tpl long", { tpl: "t".repeat(65) }],
		["tplVersion zero", { tplVersion: 0 }],
		["tplVersion fraction", { tplVersion: 1.5 }],
		["tplVersion string", { tplVersion: "1" }],
		["ref bad char", { ref: "BK 7" }],
		["ref long", { ref: "r".repeat(129) }],
		["signer missing", { signer: undefined }],
		["signer null", { signer: null }],
		["signer array", { signer: [] }],
		["signer name empty", { signer: { name: "", email: "a@b" } }],
		["signer name long", { signer: { name: "é".repeat(201), email: "a@b" } }],
		["signer name control", { signer: { name: "Al\u0007ex", email: "a@b" } }],
		["signer name DEL", { signer: { name: "Al\u007fex", email: "a@b" } }],
		["signer name lone surrogate", { signer: { name: "Al\ud800ex", email: "a@b" } }],
		["signer name number", { signer: { name: 7, email: "a@b" } }],
		["email no at", { signer: { name: "A", email: "ab" } }],
		["email two ats", { signer: { name: "A", email: "a@b@c" } }],
		["email empty local", { signer: { name: "A", email: "@b" } }],
		["email empty domain", { signer: { name: "A", email: "a@" } }],
		["email space", { signer: { name: "A", email: "a b@c" } }],
		["email DEL", { signer: { name: "A", email: "a\u007f@c" } }],
		["email long", { signer: { name: "A", email: `${"a".repeat(250)}@b.cd` } }],
		["email number", { signer: { name: "A", email: 1 } }],
		["as unknown", { as: "parent" }],
		["participant without guardian", { participant: { name: "Kid" } }],
		["participant null without guardian", { participant: null }],
		["guardian participant not object", { as: "guardian", participant: "Kid" }],
		["guardian participant bad name", { as: "guardian", participant: { name: "" } }],
		["delivery unknown", { delivery: "sms" }],
		["prefill missing", { prefill: undefined }],
		["prefill array", { prefill: [] }],
		["prefill too many", { prefill: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, "v"])) }],
		["prefill bad key", { prefill: { "bad-key": "v" } }],
		["prefill long key", { prefill: { ["k".repeat(65)]: "v" } }],
		["prefill long value", { prefill: { k: "v".repeat(501) } }],
		["prefill lone surrogate", { prefill: { k: "\udc00" } }],
		["returnUrl missing", { returnUrl: undefined }],
		["returnUrl number", { returnUrl: 5 }],
		["returnUrl long", { returnUrl: `https://events.example/booking/${"x".repeat(2020)}` }],
		["returnUrl lone surrogate", { returnUrl: "https://events.example/booking/\ud800" }],
	];

	it.each(invalid)("%s is PAYLOAD_INVALID", (_name, over) => {
		expect(errorOf(validateEsignPayload("intent", intentPayload(over)))).toBe("PAYLOAD_INVALID");
	});

	it("lifetime is checked after the other schema checks", () => {
		expect(errorOf(validateEsignPayload("intent", intentPayload({ exp: NOW_S - 60 + 1801 })))).toBe(
			"TOKEN_LIFETIME_EXCEEDED",
		);
		expect(errorOf(validateEsignPayload("intent", intentPayload({ exp: NOW_S - 60 + 1801, tpl: "" })))).toBe(
			"PAYLOAD_INVALID",
		);
	});

	it("accepts every optional field at its limits", () => {
		const payload = intentPayload({
			tplVersion: 3,
			as: "guardian",
			participant: { name: "K".repeat(200), extra: true },
			delivery: "email",
			signer: { name: "😀".repeat(200), email: `${"a".repeat(250)}@b.c`, extra: 1 },
			prefill: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k_${i}`, "v".repeat(500)])),
			ref: "r".repeat(128),
			tpl: "t".repeat(64),
			nonce: "n".repeat(64),
		});
		expect(errorOf(validateEsignPayload("intent", payload))).toBe("ok");
		for (const as of ["self", "buyer"]) expect(errorOf(validateEsignPayload("intent", intentPayload({ as })))).toBe("ok");
		expect(errorOf(validateEsignPayload("intent", intentPayload({ delivery: "inline" })))).toBe("ok");
	});

	it("rejects payloads that are not objects", () => {
		for (const p of [null, [], "x", 1]) expect(errorOf(validateEsignPayload("intent", p))).toBe("PAYLOAD_INVALID");
	});

	it("the issuer refuses to sign an invalid payload", async () => {
		await expect(signEsignToken("intent", intentPayload({ tpl: "" }), bytes(KEY_A.secret))).rejects.toThrow(
			/PAYLOAD_INVALID/,
		);
		await expect(
			signEsignToken("intent", intentPayload({ exp: NOW_S + 1800 }), bytes(KEY_A.secret)),
		).rejects.toThrow(/TOKEN_LIFETIME_EXCEEDED/);
	});

	it("the issuer requires a 32-byte secret", async () => {
		await expect(signEsignToken("intent", intentPayload(), new Uint8Array(31))).rejects.toThrow(/32 bytes/);
	});

	it("the issuer refuses a token over the type's size limit", async () => {
		const prefill = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k${i}`, "v".repeat(500)]));
		await expect(signEsignToken("intent", intentPayload({ prefill }), bytes(KEY_A.secret))).rejects.toThrow(
			/TOKEN_TOO_LARGE/,
		);
	});
});

describe("SX-NFR-02 receipt, lookup and catalog schemas", () => {
	const receiptInvalid: Array<[string, Record<string, unknown>]> = [
		["envelopeId bad", { envelopeId: "env 1" }],
		["ref bad", { ref: "" }],
		["status unknown", { status: "signed" }],
		["docSha256 short", { docSha256: "a".repeat(63) }],
		["docSha256 number", { docSha256: 1 }],
		["completed pdf bad", { pdfSha256: "B".repeat(64) }],
		["completed pdf missing", { pdfSha256: undefined }],
		["completed finalHash null", { finalHash: null }],
		["voided with pdf", { status: "voided", pdfSha256: "b".repeat(64), finalHash: null }],
		["expired with finalHash", { status: "expired", pdfSha256: null, finalHash: "c".repeat(64) }],
		["declined missing finalHash", { status: "declined", pdfSha256: null, finalHash: undefined }],
		["at string", { at: "now" }],
	];
	it.each(receiptInvalid)("receipt %s is PAYLOAD_INVALID", (_name, over) => {
		expect(errorOf(validateEsignPayload("receipt", receiptPayload(over)))).toBe("PAYLOAD_INVALID");
	});

	it("accepts every terminal status with the right hashes", () => {
		for (const status of ["declined", "voided", "expired"]) {
			expect(errorOf(validateEsignPayload("receipt", receiptPayload({ status, pdfSha256: null, finalHash: null })))).toBe(
				"ok",
			);
		}
		expect(errorOf(validateEsignPayload("receipt", receiptPayload({ pdfSha256: null })))).toBe("ok");
	});

	it("validates lookup and catalog fields", () => {
		const lookup = { v: 1, typ: "lookup", cid: KEY_A.cid, ts: NOW_S, ref: "BK7Q2M" };
		expect(errorOf(validateEsignPayload("lookup", lookup))).toBe("ok");
		expect(errorOf(validateEsignPayload("lookup", { ...lookup, ts: 1.5 }))).toBe("PAYLOAD_INVALID");
		expect(errorOf(validateEsignPayload("lookup", { ...lookup, ref: "a b" }))).toBe("PAYLOAD_INVALID");
		const catalog = { v: 1, typ: "catalog", cid: KEY_A.cid, ts: NOW_S };
		expect(errorOf(validateEsignPayload("catalog", catalog))).toBe("ok");
		expect(errorOf(validateEsignPayload("catalog", { ...catalog, ts: -1 }))).toBe("PAYLOAD_INVALID");
		expect(errorOf(validateEsignPayload("catalog", { ...catalog, cid: "x" }))).toBe("PAYLOAD_INVALID");
	});

	it("a revoked client fails receipt verification", async () => {
		const getClient = clientsA({ revoked: true });
		const secret = bytes(KEY_A.secret);
		const receipt = await signEsignToken("receipt", receiptPayload(), secret);
		expect(errorOf(await verifyReceiptToken({ token: receipt, now: NOW, getClient }))).toBe("CLIENT_REVOKED");
	});

	it("receipts in the future beyond skew are not yet valid; old receipts never expire", async () => {
		const secret = bytes(KEY_A.secret);
		const future = await signEsignToken("receipt", receiptPayload({ at: NOW_S + 61 }), secret);
		expect(errorOf(await verifyReceiptToken({ token: future, now: NOW, getClient: clientsA() }))).toBe(
			"TOKEN_NOT_YET_VALID",
		);
		const old = await signEsignToken("receipt", receiptPayload({ at: 0 }), secret);
		expect(errorOf(await verifyReceiptToken({ token: old, now: NOW, getClient: clientsA() }))).toBe("ok");
	});

	it("catalog and lookup requests issued beyond the skew are not yet valid", async () => {
		const secret = bytes(KEY_A.secret);
		const catalog = await signEsignToken("catalog", { v: 1, typ: "catalog", cid: KEY_A.cid, ts: NOW_S + 61 }, secret);
		expect(errorOf(await verifyCatalogToken({ token: catalog, now: NOW, getClient: clientsA() }))).toBe(
			"TOKEN_NOT_YET_VALID",
		);
	});
});

describe("SX-NFR-02 return URL allowlist (spec §7)", () => {
	const cases: Array<[string, boolean]> = [
		["https://events.example/booking", true],
		["https://events.example/booking/", true],
		["https://events.example/booking/BK7Q2M?x=1", true],
		["https://events.example/bookings", false],
		["https://events.example/sign/", true],
		["https://events.example/sign", false],
		["https://events.example/sign/%2e%2e/admin", false],
		["https://events.example/booking#", false],
		["https://:pw@events.example/booking", false],
		["ftp://events.example/booking", false],
		["data:text/html,x", false],
		["not a url", false],
		["https://events.example.evil/booking", false],
	];
	it.each(cases)("%s → %s", (url, allowed) => {
		expect(isReturnUrlAllowed(url, ALLOWLIST)).toBe(allowed);
	});

	it("ignores allowlist entries that break the entry rules", () => {
		const url = "https://events.example/booking";
		for (const entry of [
			"https://events.example/booking?x=1",
			"https://events.example/booking#x",
			"https://u@events.example/booking",
			"http://events.example/booking",
			"ftp://events.example/booking",
			"/booking",
		]) {
			expect([entry, isReturnUrlAllowed(url, [entry])]).toEqual([entry, false]);
		}
		expect(isReturnUrlAllowed("http://events.example/booking", ["http://events.example/booking"])).toBe(false);
	});

	it("allows plain http only for loopback hosts", () => {
		for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
			expect(isReturnUrlAllowed(`http://${host}:4321/b/1`, [`http://${host}:4321/b`])).toBe(true);
			expect(isReturnUrlAllowed(`http://${host}/b/1`, [`http://${host}:4321/b`])).toBe(false);
		}
	});

	it("defaults an entry's path to /", () => {
		expect(isReturnUrlAllowed("https://events.example/anything", ["https://events.example"])).toBe(true);
	});
});

describe("SX-NFR-02 base64url (spec §2.1)", () => {
	it("round-trips and rejects non-canonical forms", () => {
		for (let n = 0; n < 6; n++) {
			const data = Uint8Array.from({ length: n }, (_, i) => 250 - i);
			const text = encodeBase64Url(data);
			expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
			expect(decodeBase64Url(text)).toEqual(data);
		}
		for (const bad of ["A", "AB=", "A+B/", "AB C", "AB\n", "é", "AB", "AAB", "_x"]) {
			// "AB", "AAB" and "_x" have non-zero unused bits.
			expect([bad, decodeBase64Url(bad)]).toEqual([bad, undefined]);
		}
		expect(decodeBase64Url("AA")).toEqual(new Uint8Array([0]));
		expect(decodeBase64Url("_w8")).toEqual(new Uint8Array([0xff, 0x0f]));
	});
});
