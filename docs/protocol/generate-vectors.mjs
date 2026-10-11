#!/usr/bin/env node
// Generates docs/protocol/vectors.json, the test vectors for esign-intent/1 (see esign-intent-v1.md).
//
//   node docs/protocol/generate-vectors.mjs [output-path]
//
// Deterministic by construction: fixed keys, a fixed verifier clock, fixed nonces, no randomness,
// and only WebCrypto (HMAC-SHA256, SHA-256) for cryptography, so re-running reproduces the file
// byte for byte on any runtime with WebCrypto, TextEncoder and btoa.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { subtle } = globalThis.crypto;
const utf8 = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// Protocol constants (normative values live in esign-intent-v1.md)

const PREFIXES = {
	intent: "esign-intent/1",
	receipt: "esign-receipt/1",
	lookup: "esign-lookup/1",
	catalog: "esign-catalog/1",
};
const MAX_TOKEN_LENGTH = { intent: 8192, receipt: 2048, lookup: 1024, catalog: 1024 };
const SKEW = 60;
const INTENT_MAX_LIFETIME = 1800;
const REQUEST_MAX_AGE = 300;
const ERROR_CODES = [
	"TOKEN_TOO_LARGE",
	"TOKEN_MALFORMED",
	"CLIENT_UNKNOWN",
	"CLIENT_REVOKED",
	"TOKEN_INVALID",
	"PAYLOAD_INVALID",
	"TOKEN_LIFETIME_EXCEEDED",
	"TOKEN_NOT_YET_VALID",
	"TOKEN_EXPIRED",
	"RETURN_URL_NOT_ALLOWED",
	"TOKEN_REPLAYED",
	"PAIRING_MALFORMED",
];

// Fixed verifier clock: 2027-01-15T08:00:00Z.
const NOW = 1800000000;

// ---------------------------------------------------------------------------------------------
// Encoding helpers

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** RFC 4648 §5 base64url without padding. */
function b64url(bytes) {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlText(text) {
	return b64url(utf8.encode(text));
}

function bytesFrom(start, length = 32) {
	return Uint8Array.from({ length }, (_, i) => (start + i) & 0xff);
}

async function sha256Hex(text) {
	const digest = new Uint8Array(await subtle.digest("SHA-256", utf8.encode(text)));
	return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secretBytes, text) {
	const key = await subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return new Uint8Array(await subtle.sign("HMAC", key, utf8.encode(text)));
}

/** Signs an already-encoded payload segment under a prefix: the signature covers these exact bytes. */
async function signSegment(secretBytes, prefix, payloadB64) {
	return `${payloadB64}.${b64url(await hmac(secretBytes, `${prefix}.${payloadB64}`))}`;
}

/** Issuer serialisation: JSON.stringify in schema key order, no whitespace, UTF-8. */
async function mint(secretBytes, prefix, payload) {
	return signSegment(secretBytes, prefix, b64urlText(JSON.stringify(payload)));
}

/** Replaces the last character with one carrying the same data bits but non-zero padding bits. */
function nonCanonicalLastChar(segment) {
	const last = B64URL_ALPHABET.indexOf(segment.at(-1));
	// 32 bytes = 43 chars; the last char carries 4 data bits and 2 padding bits (which must be 0).
	return segment.slice(0, -1) + B64URL_ALPHABET[last | 0b01];
}

function flipFirstSignatureBit(token) {
	const [payloadB64, sigB64] = token.split(".");
	const sig = Uint8Array.from(atob(sigB64.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
	sig[0] ^= 0x01;
	return `${payloadB64}.${b64url(sig)}`;
}

// ---------------------------------------------------------------------------------------------
// Fixed keys

const KEYS = {
	A: { cid: "cl_test_aaaaaaaa", bytes: bytesFrom(0x00), role: "paired client (the Events site)" },
	B: { cid: "cl_test_bbbbbbbb", bytes: bytesFrom(0x20), role: "another client; its secret is the 'wrong secret'" },
	R: { cid: "cl_test_revoked1", bytes: bytesFrom(0x40), role: "a client revoked in the e-sign admin" },
};
const UNKNOWN_CID = "cl_test_unknown1";
for (const k of Object.values(KEYS)) {
	k.secret = b64url(k.bytes);
	k.pairing = `esign1.${k.cid}.${k.secret}`;
}

const ALLOWLIST = ["https://events.example/booking", "https://events.example/sign/"];

/** Verifier state for e-sign (verifies intent, lookup and catalog tokens). */
function esignVerifier({ now = NOW, usedNonces = [], withAllowlist = false } = {}) {
	const client = (k, revoked) => ({
		secret: k.secret,
		revoked,
		...(withAllowlist ? { returnUrlAllowlist: ALLOWLIST } : {}),
	});
	return {
		now,
		clients: { [KEYS.A.cid]: client(KEYS.A, false), [KEYS.R.cid]: client(KEYS.R, true) },
		usedNonces,
	};
}

/** Verifier state for Events (verifies receipts): it holds exactly one pairing. */
function eventsVerifier({ now = NOW } = {}) {
	return { now, clients: { [KEYS.A.cid]: { secret: KEYS.A.secret, revoked: false } }, usedNonces: [] };
}

// ---------------------------------------------------------------------------------------------
// Payload builders (keys in schema order)

const ORDER = {
	intent: [
		"v",
		"typ",
		"cid",
		"iat",
		"exp",
		"nonce",
		"tpl",
		"tplVersion",
		"ref",
		"signer",
		"as",
		"participant",
		"delivery",
		"prefill",
		"returnUrl",
	],
	receipt: ["v", "typ", "cid", "envelopeId", "ref", "status", "docSha256", "pdfSha256", "finalHash", "at"],
	lookup: ["v", "typ", "cid", "ts", "ref"],
	catalog: ["v", "typ", "cid", "ts"],
};

/** Emits schema fields in the issuer serialisation order; unknown fields follow in insertion order. */
function ordered(type, fields) {
	const out = {};
	for (const k of ORDER[type]) if (k in fields) out[k] = fields[k];
	for (const k of Object.keys(fields)) if (!(k in out)) out[k] = fields[k];
	return out;
}

function intentPayload(overrides = {}, { cid = KEYS.A.cid } = {}) {
	return ordered("intent", {
		v: 1,
		typ: "intent",
		cid,
		iat: NOW - 60,
		exp: NOW + 840,
		nonce: "n0nce-AAAAAAAAAAAAAAAA",
		tpl: "tpl_waiver",
		ref: "BK7Q2M:ATT01",
		signer: { name: "Alex Example", email: "alex@example.com" },
		prefill: {},
		returnUrl: "https://events.example/booking/BK7Q2M",
		...overrides,
	});
}

async function receiptPayload(overrides = {}) {
	return ordered("receipt", {
		v: 1,
		typ: "receipt",
		cid: KEYS.A.cid,
		envelopeId: "env_01J9Z6Q8",
		ref: "BK7Q2M:ATT01",
		status: "completed",
		docSha256: await sha256Hex("document snapshot"),
		pdfSha256: await sha256Hex("signed pdf"),
		finalHash: await sha256Hex("audit chain head"),
		at: NOW - 120,
		...overrides,
	});
}

function lookupPayload(overrides = {}, { cid = KEYS.A.cid } = {}) {
	return ordered("lookup", { v: 1, typ: "lookup", cid, ts: NOW - 10, ref: "BK7Q2M:ATT01", ...overrides });
}

function catalogPayload(overrides = {}, { cid = KEYS.A.cid } = {}) {
	return ordered("catalog", { v: 1, typ: "catalog", cid, ts: NOW - 10, ...overrides });
}

/** Grows filler until the minted token is exactly `targetLength` characters. */
async function mintToLength(key, prefix, build, targetLength) {
	for (let n = 0; n < targetLength; n++) {
		const payload = build("x".repeat(n));
		const segLen = Math.ceil((utf8.encode(JSON.stringify(payload)).length * 4) / 3);
		if (segLen + 1 + 43 === targetLength) return { payload, token: await mint(key.bytes, prefix, payload) };
	}
	throw new Error(`cannot reach token length ${targetLength}`);
}

/** Splits filler into prefill values of at most 500 code points (the schema limit). */
function prefillFiller(filler) {
	const prefill = {};
	for (let i = 0; i * 500 < filler.length; i++) {
		prefill[`f${String(i).padStart(2, "0")}`] = filler.slice(i * 500, (i + 1) * 500);
	}
	return prefill;
}

// ---------------------------------------------------------------------------------------------
// Vector builders

const vectors = [];

function add(type, name, description, input, verifier, expected) {
	vectors.push({ name: `${type}/${name}`, type, description, input, verifier, expected });
}

const ok = (payload) => ({ ok: true, payload });
const fail = (error) => ({ ok: false, error });

/** A token minted normally under `prefix` (default: the type's own prefix). */
async function tokenVector(type, name, description, payload, verifier, expected, opts = {}) {
	const key = opts.key ?? KEYS.A;
	const prefix = opts.prefix ?? PREFIXES[type];
	const token = await mint(key.bytes, prefix, payload);
	add(
		type,
		name,
		description,
		{
			token: opts.transform ? opts.transform(token) : token,
			expectedPrefix: PREFIXES[type],
			signedWithPrefix: prefix,
			signedWithSecret: key.secret,
			payload,
			...(opts.tamper ? { tamper: opts.tamper } : {}),
		},
		verifier,
		expected,
	);
	return token;
}

/** A raw token string (malformed inputs); `signedWithPrefix` set only when it carries a real HMAC. */
function rawVector(type, name, description, token, verifier, expected, extra = {}) {
	add(type, name, description, { token, expectedPrefix: PREFIXES[type], ...extra }, verifier, expected);
}

/** Signs an arbitrary payload segment (non-JSON, invalid UTF-8 …) so only the payload is at fault. */
async function signedRawVector(type, name, description, payloadBytes, verifier, expected) {
	const token = await signSegment(KEYS.A.bytes, PREFIXES[type], b64url(payloadBytes));
	rawVector(type, name, description, token, verifier, expected, {
		signedWithPrefix: PREFIXES[type],
		signedWithSecret: KEYS.A.secret,
	});
}

async function intentVectors() {
	const t = "intent";
	const v = (o) => esignVerifier({ withAllowlist: true, ...o });

	const base = intentPayload();
	const validToken = await tokenVector(
		t,
		"valid-minimal",
		"Minimal valid intent: optional fields omitted, so as=self and delivery=inline.",
		base,
		v(),
		ok(base),
	);

	const full = intentPayload({
		nonce: "n0nce-BBBBBBBBBBBBBBBB",
		tplVersion: 3,
		ref: "BK7Q2M:ATT02",
		signer: { name: "Zoë Ångström-Ñúñez", email: "zoe@example.com" },
		as: "guardian",
		participant: { name: "Léa Ångström" },
		delivery: "inline",
		prefill: { emergencyContact: "Mo Ångström 07700 900123", medical: "None" },
	});
	await tokenVector(
		t,
		"valid-guardian-utf8",
		"Buyer signs inline as guardian for a minor; non-ASCII names exercise UTF-8 payload decoding.",
		full,
		v(),
		ok(full),
	);

	const email = intentPayload({
		nonce: "n0nce-CCCCCCCCCCCCCCCC",
		ref: "BK7Q2M:ATT03",
		signer: { name: "Sam Adult", email: "sam@example.com" },
		as: "self",
		delivery: "email",
	});
	await tokenVector(
		t,
		"valid-email-delivery",
		"Another adult attendee signs for themselves by email (delivery=email).",
		email,
		v(),
		ok(email),
	);

	const unknownField = { ...intentPayload({ nonce: "n0nce-DDDDDDDDDDDDDDDD" }), ext: { future: true } };
	await tokenVector(
		t,
		"valid-unknown-field-ignored",
		"Unknown top-level fields are ignored, not rejected.",
		unknownField,
		v(),
		ok(unknownField),
	);

	// Clock and lifetime
	const atExpiry = intentPayload({ iat: NOW - 1860, exp: NOW - SKEW });
	await tokenVector(
		t,
		"valid-expiry-within-skew",
		"now = exp + 60: still inside the 60 s clock-skew allowance.",
		atExpiry,
		v(),
		ok(atExpiry),
	);
	await tokenVector(
		t,
		"expired",
		"now = exp + 61: one second past the skew allowance.",
		intentPayload({ iat: NOW - 1861, exp: NOW - SKEW - 1 }),
		v(),
		fail("TOKEN_EXPIRED"),
	);
	const earlyOk = intentPayload({ iat: NOW + SKEW, exp: NOW + SKEW + 600 });
	await tokenVector(
		t,
		"valid-iat-within-skew",
		"iat = now + 60: the issuer's clock is ahead, within the skew allowance.",
		earlyOk,
		v(),
		ok(earlyOk),
	);
	await tokenVector(
		t,
		"not-yet-valid",
		"iat = now + 61: issued in the future beyond the skew allowance.",
		intentPayload({ iat: NOW + SKEW + 1, exp: NOW + SKEW + 601 }),
		v(),
		fail("TOKEN_NOT_YET_VALID"),
	);
	const maxLife = intentPayload({ iat: NOW - 60, exp: NOW - 60 + INTENT_MAX_LIFETIME });
	await tokenVector(
		t,
		"valid-max-lifetime",
		"exp - iat = 1800 s, the maximum intent lifetime.",
		maxLife,
		v(),
		ok(maxLife),
	);
	await tokenVector(
		t,
		"lifetime-exceeded",
		"exp - iat = 1801 s: longer than the 30-minute cap.",
		intentPayload({ iat: NOW - 60, exp: NOW - 60 + INTENT_MAX_LIFETIME + 1 }),
		v(),
		fail("TOKEN_LIFETIME_EXCEEDED"),
	);
	await tokenVector(
		t,
		"exp-not-after-iat",
		"exp = iat: a token must have a positive lifetime.",
		intentPayload({ iat: NOW, exp: NOW }),
		v(),
		fail("PAYLOAD_INVALID"),
	);

	// Nonces
	await tokenVector(
		t,
		"replayed-nonce",
		"The (cid, nonce) pair was already consumed.",
		base,
		v({ usedNonces: [{ cid: KEYS.A.cid, nonce: base.nonce }] }),
		fail("TOKEN_REPLAYED"),
	);
	await tokenVector(
		t,
		"valid-nonce-scoped-to-client",
		"The same nonce was used by a different client; nonces are scoped per cid.",
		base,
		v({ usedNonces: [{ cid: KEYS.R.cid, nonce: base.nonce }] }),
		ok(base),
	);

	// Signature, prefix and key failures
	await tokenVector(
		t,
		"wrong-prefix-receipt",
		"An intent payload signed under esign-receipt/1 (cross-type confusion).",
		base,
		v(),
		fail("TOKEN_INVALID"),
		{ prefix: PREFIXES.receipt },
	);
	const receiptToken = await mint(KEYS.A.bytes, PREFIXES.receipt, await receiptPayload());
	rawVector(
		t,
		"receipt-token-presented",
		"A genuine receipt token presented to the intent verifier.",
		receiptToken,
		v(),
		fail("TOKEN_INVALID"),
		{ signedWithPrefix: PREFIXES.receipt, signedWithSecret: KEYS.A.secret },
	);
	await tokenVector(
		t,
		"typ-mismatch-under-intent-prefix",
		"Correctly signed under esign-intent/1, but typ is 'receipt'.",
		intentPayload({ typ: "receipt" }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	const [, validSig] = validToken.split(".");
	const tamperedPayload = b64urlText(
		JSON.stringify(intentPayload({ signer: { name: "Alex Example", email: "attacker@example.net" } })),
	);
	rawVector(
		t,
		"tampered-payload",
		"signer.email changed after signing; the original signature is kept.",
		`${tamperedPayload}.${validSig}`,
		v(),
		fail("TOKEN_INVALID"),
		{ signedWithPrefix: PREFIXES.intent, signedWithSecret: KEYS.A.secret, tamper: "payload segment replaced" },
	);
	await tokenVector(
		t,
		"tampered-signature",
		"Lowest bit of the first signature byte flipped.",
		base,
		v(),
		fail("TOKEN_INVALID"),
		{ transform: flipFirstSignatureBit, tamper: "signature bit flipped" },
	);
	await tokenVector(
		t,
		"wrong-secret",
		"Claims cid A but is signed with client B's secret.",
		base,
		v(),
		fail("TOKEN_INVALID"),
		{ key: KEYS.B },
	);
	await tokenVector(
		t,
		"revoked-client",
		"Signed correctly by a client that has been revoked.",
		intentPayload({}, { cid: KEYS.R.cid }),
		v(),
		fail("CLIENT_REVOKED"),
		{ key: KEYS.R },
	);
	await tokenVector(
		t,
		"unknown-client",
		"cid is not registered with the verifier.",
		intentPayload({}, { cid: UNKNOWN_CID }),
		v(),
		fail("CLIENT_UNKNOWN"),
		{ key: KEYS.B },
	);
	await tokenVector(
		t,
		"order-revoked-before-expiry",
		"Revoked and expired: client checks run before time checks.",
		intentPayload({ iat: NOW - 4000, exp: NOW - 3000 }, { cid: KEYS.R.cid }),
		v(),
		fail("CLIENT_REVOKED"),
		{ key: KEYS.R },
	);
	await tokenVector(
		t,
		"order-signature-before-expiry",
		"Bad signature and expired: the signature check runs before time checks.",
		intentPayload({ iat: NOW - 4000, exp: NOW - 3000 }),
		v(),
		fail("TOKEN_INVALID"),
		{ transform: flipFirstSignatureBit, tamper: "signature bit flipped" },
	);

	// Malformed
	rawVector(
		t,
		"malformed-no-dot",
		"A single segment with no '.' separator.",
		validToken.replace(".", ""),
		v(),
		fail("TOKEN_MALFORMED"),
	);
	rawVector(
		t,
		"malformed-three-segments",
		"Three segments (JWS-style header added).",
		`eyJhbGciOiJIUzI1NiJ9.${validToken}`,
		v(),
		fail("TOKEN_MALFORMED"),
	);
	rawVector(t, "malformed-empty-payload", "Empty payload segment.", `.${validSig}`, v(), fail("TOKEN_MALFORMED"));
	rawVector(
		t,
		"malformed-standard-base64",
		"Uses '+' from the standard base64 alphabet.",
		`+${validToken.slice(1)}`,
		v(),
		fail("TOKEN_MALFORMED"),
	);
	rawVector(
		t,
		"malformed-padding",
		"Signature segment carries '=' padding.",
		`${validToken}=`,
		v(),
		fail("TOKEN_MALFORMED"),
	);
	rawVector(
		t,
		"malformed-noncanonical-signature",
		"Signature's last character has non-zero padding bits (decodes to the same bytes in lenient decoders).",
		`${validToken.split(".")[0]}.${nonCanonicalLastChar(validSig)}`,
		v(),
		fail("TOKEN_MALFORMED"),
		{ tamper: "non-canonical base64url" },
	);
	rawVector(
		t,
		"malformed-short-signature",
		"Signature segment decodes to 31 bytes, not 32.",
		`${validToken.split(".")[0]}.${validSig.slice(0, 42)}`,
		v(),
		fail("TOKEN_MALFORMED"),
	);
	await signedRawVector(
		t,
		"malformed-not-json",
		"Payload is the UTF-8 text 'hello', correctly signed.",
		utf8.encode("hello"),
		v(),
		fail("TOKEN_MALFORMED"),
	);
	await signedRawVector(
		t,
		"malformed-invalid-utf8",
		"Payload bytes are not valid UTF-8, correctly signed.",
		Uint8Array.of(0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d),
		v(),
		fail("TOKEN_MALFORMED"),
	);
	await signedRawVector(
		t,
		"malformed-json-array",
		"Payload is a JSON array, not an object.",
		utf8.encode(JSON.stringify([base])),
		v(),
		fail("TOKEN_MALFORMED"),
	);
	const noCid = { ...base };
	delete noCid.cid;
	await signedRawVector(
		t,
		"malformed-missing-cid",
		"Payload has no cid, so no key can be selected.",
		utf8.encode(JSON.stringify(noCid)),
		v(),
		fail("TOKEN_MALFORMED"),
	);

	// Size
	const sized = (filler) => intentPayload({ nonce: "n0nce-SIZESIZESIZESIZE", prefill: prefillFiller(filler) });
	const atMax = await mintToLength(KEYS.A, PREFIXES.intent, sized, MAX_TOKEN_LENGTH.intent);
	add(
		t,
		"valid-max-length",
		"Exactly 8192 characters: the largest allowed intent.",
		{
			token: atMax.token,
			expectedPrefix: PREFIXES.intent,
			signedWithPrefix: PREFIXES.intent,
			signedWithSecret: KEYS.A.secret,
			payload: atMax.payload,
		},
		v(),
		ok(atMax.payload),
	);
	// 8193 is not a reachable base64url length for this shape, so 8194 is the smallest oversize token.
	const over = await mintToLength(KEYS.A, PREFIXES.intent, sized, MAX_TOKEN_LENGTH.intent + 2);
	add(
		t,
		"oversize",
		"8194 characters: over the 8192 limit; rejected before any decoding.",
		{
			token: over.token,
			expectedPrefix: PREFIXES.intent,
			signedWithPrefix: PREFIXES.intent,
			signedWithSecret: KEYS.A.secret,
			payload: over.payload,
		},
		v(),
		fail("TOKEN_TOO_LARGE"),
	);

	// Schema
	await tokenVector(
		t,
		"version-2-under-v1-prefix",
		"v = 2 inside an esign-intent/1 token.",
		intentPayload({ v: 2 }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	await tokenVector(
		t,
		"guardian-without-participant",
		"as = guardian requires participant.",
		intentPayload({ as: "guardian" }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	await tokenVector(
		t,
		"nonce-too-short",
		"nonce shorter than 16 characters.",
		intentPayload({ nonce: "short" }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	await tokenVector(
		t,
		"prefill-non-string",
		"prefill values must be strings.",
		intentPayload({ prefill: { age: 17 } }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	await tokenVector(
		t,
		"iat-not-integer",
		"Times are integer seconds.",
		intentPayload({ iat: NOW - 60.5 }),
		v(),
		fail("PAYLOAD_INVALID"),
	);

	// Return URL allowlist (allowlist: https://events.example/booking, https://events.example/sign/)
	const returnUrlCase = async (name, url, expected, description, nonceSuffix) => {
		const payload = intentPayload({ nonce: `n0nce-URL${nonceSuffix}`.padEnd(22, "U"), returnUrl: url });
		await tokenVector(
			t,
			name,
			`returnUrl ${url}: ${description}`,
			payload,
			v(),
			expected === "ok" ? ok(payload) : fail(expected),
		);
	};
	await returnUrlCase(
		"valid-return-url-exact-path-query",
		"https://events.example/booking?b=BK7Q2M",
		"ok",
		"exact allowlisted path; the query is not compared.",
		"01",
	);
	await returnUrlCase(
		"valid-return-url-normalised",
		"https://EVENTS.example:443/sign/BK7Q2M",
		"ok",
		"host case and the default port are normalised before comparison.",
		"02",
	);
	await returnUrlCase(
		"return-url-other-host",
		"https://evil.example/booking",
		"RETURN_URL_NOT_ALLOWED",
		"host not on the allowlist.",
		"03",
	);
	await returnUrlCase(
		"return-url-path-boundary",
		"https://events.example/bookings",
		"RETURN_URL_NOT_ALLOWED",
		"'/booking' is a prefix only on a '/' segment boundary.",
		"04",
	);
	await returnUrlCase(
		"return-url-port",
		"https://events.example:8443/booking",
		"RETURN_URL_NOT_ALLOWED",
		"port must match exactly.",
		"05",
	);
	await returnUrlCase(
		"return-url-scheme",
		"http://events.example/booking",
		"RETURN_URL_NOT_ALLOWED",
		"scheme must match exactly.",
		"06",
	);
	await returnUrlCase(
		"return-url-userinfo",
		"https://user@events.example/booking",
		"RETURN_URL_NOT_ALLOWED",
		"userinfo is never allowed.",
		"07",
	);
	await returnUrlCase(
		"return-url-fragment",
		"https://events.example/booking#x",
		"RETURN_URL_NOT_ALLOWED",
		"a fragment is reserved for the receipt.",
		"08",
	);
	await returnUrlCase(
		"return-url-dot-segments",
		"https://events.example/booking/../admin",
		"RETURN_URL_NOT_ALLOWED",
		"dot segments are resolved first (path becomes /admin).",
		"09",
	);
	await returnUrlCase(
		"return-url-relative",
		"/booking/BK7Q2M",
		"RETURN_URL_NOT_ALLOWED",
		"must be an absolute URL.",
		"10",
	);
	await returnUrlCase(
		"return-url-javascript",
		"javascript:alert(1)",
		"RETURN_URL_NOT_ALLOWED",
		"non-http(s) scheme.",
		"11",
	);
	await tokenVector(
		t,
		"order-allowlist-before-nonce",
		"Off-allowlist and replayed: the allowlist is checked before the nonce.",
		intentPayload({ returnUrl: "https://evil.example/booking" }),
		v({ usedNonces: [{ cid: KEYS.A.cid, nonce: base.nonce }] }),
		fail("RETURN_URL_NOT_ALLOWED"),
	);
}

async function receiptVectors() {
	const t = "receipt";
	const v = eventsVerifier;

	const completed = await receiptPayload();
	const validToken = await tokenVector(
		t,
		"valid-completed",
		"Completed envelope, as delivered via returnUrl#receipt=.",
		completed,
		v(),
		ok(completed),
	);
	const declined = await receiptPayload({ status: "declined", pdfSha256: null, finalHash: null });
	await tokenVector(t, "valid-declined", "Declined envelope: no PDF and no final hash.", declined, v(), ok(declined));
	const pending = await receiptPayload({ pdfSha256: null });
	await tokenVector(
		t,
		"valid-completed-pdf-pending",
		"Completed, but the signed PDF is still being generated (pdfSha256 null).",
		pending,
		v(),
		ok(pending),
	);
	const old = await receiptPayload({ at: NOW - 30 * 86400 });
	await tokenVector(
		t,
		"valid-old",
		"Receipts do not expire: 'at' 30 days ago (email signer, found by reconciliation).",
		old,
		v(),
		ok(old),
	);
	const skewOk = await receiptPayload({ at: NOW + SKEW });
	await tokenVector(t, "valid-at-within-skew", "at = now + 60: within the skew allowance.", skewOk, v(), ok(skewOk));
	await tokenVector(
		t,
		"not-yet-valid",
		"at = now + 61: in the future beyond the skew allowance.",
		await receiptPayload({ at: NOW + SKEW + 1 }),
		v(),
		fail("TOKEN_NOT_YET_VALID"),
	);

	await tokenVector(
		t,
		"wrong-prefix-intent",
		"A receipt payload signed under esign-intent/1 (cross-type confusion).",
		completed,
		v(),
		fail("TOKEN_INVALID"),
		{ prefix: PREFIXES.intent },
	);
	const intentToken = await mint(KEYS.A.bytes, PREFIXES.intent, intentPayload());
	rawVector(
		t,
		"intent-token-presented",
		"A genuine intent token presented to the receipt verifier.",
		intentToken,
		v(),
		fail("TOKEN_INVALID"),
		{ signedWithPrefix: PREFIXES.intent, signedWithSecret: KEYS.A.secret },
	);
	const [, validSig] = validToken.split(".");
	const forged = b64urlText(JSON.stringify(await receiptPayload({ ref: "BK7Q2M:ATT09" })));
	rawVector(
		t,
		"tampered-payload",
		"ref changed after signing to claim another attendee's waiver.",
		`${forged}.${validSig}`,
		v(),
		fail("TOKEN_INVALID"),
		{ signedWithPrefix: PREFIXES.receipt, signedWithSecret: KEYS.A.secret, tamper: "payload segment replaced" },
	);
	await tokenVector(
		t,
		"tampered-signature",
		"Lowest bit of the first signature byte flipped.",
		completed,
		v(),
		fail("TOKEN_INVALID"),
		{ transform: flipFirstSignatureBit, tamper: "signature bit flipped" },
	);
	await tokenVector(t, "wrong-secret", "Signed with client B's secret.", completed, v(), fail("TOKEN_INVALID"), {
		key: KEYS.B,
	});
	await tokenVector(
		t,
		"unknown-client",
		"cid does not match the verifier's pairing.",
		{ ...completed, cid: KEYS.B.cid },
		v(),
		fail("CLIENT_UNKNOWN"),
		{ key: KEYS.B },
	);

	await tokenVector(
		t,
		"uppercase-hex",
		"Hashes must be lowercase hex.",
		await receiptPayload({ docSha256: (await sha256Hex("document snapshot")).toUpperCase() }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	await tokenVector(
		t,
		"completed-without-final-hash",
		"A completed receipt must carry finalHash.",
		await receiptPayload({ finalHash: null }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	await tokenVector(
		t,
		"declined-with-pdf-hash",
		"Only completed receipts may carry pdfSha256.",
		await receiptPayload({ status: "declined", finalHash: null }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	await tokenVector(
		t,
		"unknown-status",
		"status outside the enumeration.",
		await receiptPayload({ status: "signed" }),
		v(),
		fail("PAYLOAD_INVALID"),
	);

	rawVector(
		t,
		"malformed-bad-base64url",
		"Payload segment contains '/'.",
		`/${validToken.slice(1)}`,
		v(),
		fail("TOKEN_MALFORMED"),
	);
	rawVector(
		t,
		"malformed-empty-signature",
		"Signature segment is empty.",
		`${validToken.split(".")[0]}.`,
		v(),
		fail("TOKEN_MALFORMED"),
	);
	const big = await mintToLength(
		KEYS.A,
		PREFIXES.receipt,
		(f) => ({ ...completed, pad: f }),
		MAX_TOKEN_LENGTH.receipt + 2,
	);
	add(
		t,
		"oversize",
		"2050 characters: over the 2048 limit (padded with an unknown field).",
		{
			token: big.token,
			expectedPrefix: PREFIXES.receipt,
			signedWithPrefix: PREFIXES.receipt,
			signedWithSecret: KEYS.A.secret,
			payload: big.payload,
		},
		v(),
		fail("TOKEN_TOO_LARGE"),
	);
}

async function lookupVectors() {
	const t = "lookup";
	const v = esignVerifier;

	const base = lookupPayload();
	const validToken = await tokenVector(t, "valid", "Client-signed receipt lookup for one ref.", base, v(), ok(base));
	const edge = lookupPayload({ ts: NOW - REQUEST_MAX_AGE - SKEW });
	await tokenVector(
		t,
		"valid-max-age",
		"now = ts + 360: at the edge of the 300 s age limit plus 60 s skew.",
		edge,
		v(),
		ok(edge),
	);
	await tokenVector(
		t,
		"expired",
		"now = ts + 361: older than the 300 s age limit plus skew.",
		lookupPayload({ ts: NOW - REQUEST_MAX_AGE - SKEW - 1 }),
		v(),
		fail("TOKEN_EXPIRED"),
	);
	await tokenVector(
		t,
		"not-yet-valid",
		"ts = now + 61.",
		lookupPayload({ ts: NOW + SKEW + 1 }),
		v(),
		fail("TOKEN_NOT_YET_VALID"),
	);
	await tokenVector(
		t,
		"wrong-prefix-catalog",
		"A lookup payload signed under esign-catalog/1.",
		base,
		v(),
		fail("TOKEN_INVALID"),
		{ prefix: PREFIXES.catalog },
	);
	const [, validSig] = validToken.split(".");
	rawVector(
		t,
		"tampered-ref",
		"ref changed after signing to read another booking's receipt.",
		`${b64urlText(JSON.stringify(lookupPayload({ ref: "ZZ9X9X:ATT01" })))}.${validSig}`,
		v(),
		fail("TOKEN_INVALID"),
		{ signedWithPrefix: PREFIXES.lookup, signedWithSecret: KEYS.A.secret, tamper: "payload segment replaced" },
	);
	await tokenVector(
		t,
		"revoked-client",
		"Signed by a revoked client.",
		lookupPayload({}, { cid: KEYS.R.cid }),
		v(),
		fail("CLIENT_REVOKED"),
		{ key: KEYS.R },
	);
	await tokenVector(
		t,
		"unknown-client",
		"cid is not registered.",
		lookupPayload({}, { cid: UNKNOWN_CID }),
		v(),
		fail("CLIENT_UNKNOWN"),
		{ key: KEYS.B },
	);
	const noRef = lookupPayload();
	delete noRef.ref;
	await tokenVector(t, "missing-ref", "ref is required.", noRef, v(), fail("PAYLOAD_INVALID"));
	rawVector(
		t,
		"malformed-padding",
		"Payload segment padded with '='.",
		`${validToken.split(".")[0]}==.${validSig}`,
		v(),
		fail("TOKEN_MALFORMED"),
	);
	const big = await mintToLength(KEYS.A, PREFIXES.lookup, (f) => ({ ...base, pad: f }), MAX_TOKEN_LENGTH.lookup + 2);
	add(
		t,
		"oversize",
		"1026 characters: over the 1024 limit.",
		{
			token: big.token,
			expectedPrefix: PREFIXES.lookup,
			signedWithPrefix: PREFIXES.lookup,
			signedWithSecret: KEYS.A.secret,
			payload: big.payload,
		},
		v(),
		fail("TOKEN_TOO_LARGE"),
	);
}

async function catalogVectors() {
	const t = "catalog";
	const v = esignVerifier;

	const base = catalogPayload();
	const validToken = await tokenVector(t, "valid", "Client-signed template catalogue request.", base, v(), ok(base));
	await tokenVector(
		t,
		"expired",
		"now = ts + 361.",
		catalogPayload({ ts: NOW - REQUEST_MAX_AGE - SKEW - 1 }),
		v(),
		fail("TOKEN_EXPIRED"),
	);
	await tokenVector(
		t,
		"wrong-prefix-lookup",
		"A catalog payload signed under esign-lookup/1 (typ check alone would pass).",
		base,
		v(),
		fail("TOKEN_INVALID"),
		{ prefix: PREFIXES.lookup },
	);
	const lookupToken = await mint(KEYS.A.bytes, PREFIXES.lookup, lookupPayload());
	rawVector(
		t,
		"lookup-token-presented",
		"A genuine lookup token presented to the catalog verifier.",
		lookupToken,
		v(),
		fail("TOKEN_INVALID"),
		{ signedWithPrefix: PREFIXES.lookup, signedWithSecret: KEYS.A.secret },
	);
	await tokenVector(t, "wrong-secret", "Signed with client B's secret.", base, v(), fail("TOKEN_INVALID"), {
		key: KEYS.B,
	});
	await tokenVector(
		t,
		"revoked-client",
		"Signed by a revoked client.",
		catalogPayload({}, { cid: KEYS.R.cid }),
		v(),
		fail("CLIENT_REVOKED"),
		{ key: KEYS.R },
	);
	await tokenVector(
		t,
		"unknown-client",
		"cid is not registered.",
		catalogPayload({}, { cid: UNKNOWN_CID }),
		v(),
		fail("CLIENT_UNKNOWN"),
		{ key: KEYS.B },
	);
	await tokenVector(
		t,
		"typ-mismatch",
		"Signed under esign-catalog/1 but typ is 'lookup'.",
		catalogPayload({ typ: "lookup" }),
		v(),
		fail("PAYLOAD_INVALID"),
	);
	rawVector(
		t,
		"malformed-empty-signature",
		"Signature segment is empty.",
		`${validToken.split(".")[0]}.`,
		v(),
		fail("TOKEN_MALFORMED"),
	);
	const big = await mintToLength(KEYS.A, PREFIXES.catalog, (f) => ({ ...base, pad: f }), MAX_TOKEN_LENGTH.catalog + 2);
	add(
		t,
		"oversize",
		"1026 characters: over the 1024 limit.",
		{
			token: big.token,
			expectedPrefix: PREFIXES.catalog,
			signedWithPrefix: PREFIXES.catalog,
			signedWithSecret: KEYS.A.secret,
			payload: big.payload,
		},
		v(),
		fail("TOKEN_TOO_LARGE"),
	);
}

function pairingVectors() {
	const t = "pairing";
	const p = (name, description, pairing, expected) => add(t, name, description, { pairing }, undefined, expected);
	const { cid, secret, pairing } = KEYS.A;
	p("valid", "esign1.<clientId>.<43-character base64url secret>.", pairing, { ok: true, clientId: cid, secret });
	p("wrong-version", "Unknown pairing version.", pairing.replace("esign1.", "esign2."), {
		ok: false,
		error: "PAIRING_MALFORMED",
	});
	p("missing-secret", "Only two segments.", `esign1.${cid}`, { ok: false, error: "PAIRING_MALFORMED" });
	p("extra-segment", "Four segments.", `${pairing}.x`, { ok: false, error: "PAIRING_MALFORMED" });
	p("short-secret", "Secret decodes to 31 bytes.", `esign1.${cid}.${b64url(KEYS.A.bytes.slice(0, 31))}`, {
		ok: false,
		error: "PAIRING_MALFORMED",
	});
	p("padded-secret", "Secret carries '=' padding.", `${pairing}=`, { ok: false, error: "PAIRING_MALFORMED" });
	p(
		"noncanonical-secret",
		"Secret's last character has non-zero padding bits.",
		`esign1.${cid}.${nonCanonicalLastChar(secret)}`,
		{ ok: false, error: "PAIRING_MALFORMED" },
	);
	p("bad-client-id", "clientId contains a space.", `esign1.cl test.${secret}`, {
		ok: false,
		error: "PAIRING_MALFORMED",
	});
	p("surrounding-whitespace", "Parsers do not trim; settings UIs trim before storing.", ` ${pairing}\n`, {
		ok: false,
		error: "PAIRING_MALFORMED",
	});
}

// ---------------------------------------------------------------------------------------------

await intentVectors();
await receiptVectors();
await lookupVectors();
await catalogVectors();
pairingVectors();

const doc = {
	protocol: "esign-intent/1",
	spec: "docs/protocol/esign-intent-v1.md",
	generator: "docs/protocol/generate-vectors.mjs",
	note: "Generated file. Do not edit by hand; change the generator and re-run it. Secrets here are test keys only.",
	constants: {
		prefixes: PREFIXES,
		maxTokenLength: MAX_TOKEN_LENGTH,
		clockSkewSeconds: SKEW,
		intentMaxLifetimeSeconds: INTENT_MAX_LIFETIME,
		requestMaxAgeSeconds: REQUEST_MAX_AGE,
	},
	errorCodes: ERROR_CODES,
	keys: Object.fromEntries(
		Object.entries(KEYS).map(([id, k]) => [id, { cid: k.cid, secret: k.secret, pairing: k.pairing, role: k.role }]),
	),
	vectors,
};

const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "vectors.json");
writeFileSync(out, `${JSON.stringify(doc, null, "\t")}\n`);
