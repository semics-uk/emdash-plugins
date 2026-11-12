#!/usr/bin/env node
// Generates docs/protocol/voucher-vectors.json, the test vectors for voucher/1 (see voucher-v1.md).
//
//   node docs/protocol/generate-voucher-vectors.mjs [output-path]
//
// Deterministic: fixed keys, a fixed verifier clock, no randomness, and only WebCrypto (HMAC-SHA256,
// SHA-256), so re-running reproduces the file byte for byte.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { subtle } = globalThis.crypto;
const utf8 = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// Protocol constants (normative values live in voucher-v1.md)

const PREFIXES = { hold: "voucher-hold/1", settle: "voucher-settle/1", lookup: "voucher-lookup/1" };
const MAX_TOKEN_LENGTH = { hold: 1024, settle: 1024, lookup: 1024 };
const SKEW = 60;
const HOLD_MAX_LIFETIME = 1800;
const REQUEST_MAX_AGE = 300;
const MAX_MINOR = 10_000_000;
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
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
	"PAIRING_MALFORMED",
];

// Fixed verifier clock: 2027-01-15T08:00:00Z (the esign-intent/1 vectors use the same).
const NOW = 1800000000;

// ---------------------------------------------------------------------------------------------
// Encoding helpers

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function b64url(bytes) {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const b64urlText = (text) => b64url(utf8.encode(text));
const bytesFrom = (start, length = 32) => Uint8Array.from({ length }, (_, i) => (start + i) & 0xff);
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(secretBytes, text) {
	const key = await subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return new Uint8Array(await subtle.sign("HMAC", key, utf8.encode(text)));
}

async function signSegment(secretBytes, prefix, payloadB64) {
	return `${payloadB64}.${b64url(await hmac(secretBytes, `${prefix}.${payloadB64}`))}`;
}

const mint = (secretBytes, prefix, payload) => signSegment(secretBytes, prefix, b64urlText(JSON.stringify(payload)));

/** Same data bits in the last character, but a non-zero padding bit (non-canonical). */
function nonCanonicalLastChar(segment) {
	const last = B64URL_ALPHABET.indexOf(segment.at(-1));
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
	A: { cid: "cl_test_aaaaaaaa", bytes: bytesFrom(0x60), role: "paired client (the Events site)" },
	B: { cid: "cl_test_bbbbbbbb", bytes: bytesFrom(0x80), role: "another client; its secret is the 'wrong secret'" },
	R: { cid: "cl_test_revoked1", bytes: bytesFrom(0xa0), role: "a client revoked in the Vouchers admin" },
};
const UNKNOWN_CID = "cl_test_unknown1";
for (const k of Object.values(KEYS)) {
	k.secret = b64url(k.bytes);
	k.pairing = `voucher1.${k.cid}.${k.secret}`;
}

/** Events verifies hold tokens and lookup requests: it holds exactly one pairing. */
const eventsVerifier = (now = NOW) => ({ now, clients: { [KEYS.A.cid]: { secret: KEYS.A.secret, revoked: false } } });

/** Vouchers verifies settle tokens against its client table. */
const vouchersVerifier = (now = NOW) => ({
	now,
	clients: {
		[KEYS.A.cid]: { secret: KEYS.A.secret, revoked: false },
		[KEYS.R.cid]: { secret: KEYS.R.secret, revoked: true },
	},
});

const VERIFIER = { hold: eventsVerifier, settle: vouchersVerifier, lookup: eventsVerifier };

// ---------------------------------------------------------------------------------------------
// Payload builders (keys in schema order, unknown fields after)

const ORDER = {
	hold: ["v", "typ", "cid", "rid", "iat", "exp", "ref", "kind", "amountMinor", "currency", "line"],
	settle: ["v", "typ", "cid", "rid", "ref", "outcome", "creditMinor", "at"],
	lookup: ["v", "typ", "cid", "ts", "ref", "rid"],
};

function ordered(type, fields) {
	const out = {};
	for (const k of ORDER[type]) if (k in fields) out[k] = fields[k];
	for (const k of Object.keys(fields)) if (!(k in out)) out[k] = fields[k];
	return out;
}

/** Drops fields set to `undefined` in overrides, so a vector can omit a required field. */
function build(type, base, overrides) {
	const fields = { ...base, ...overrides };
	for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
	return ordered(type, fields);
}

const holdPayload = (o = {}, cid = KEYS.A.cid) =>
	build(
		"hold",
		{
			v: 1,
			typ: "hold",
			cid,
			rid: "rd_01JB7Q2M",
			iat: NOW - 60,
			exp: NOW + 840,
			ref: "BK7Q2M",
			kind: "money",
			amountMinor: 2500,
			currency: "GBP",
		},
		o,
	);

const activityHold = (o = {}) =>
	holdPayload({
		rid: "rd_01JB7Q2N",
		kind: "activity",
		amountMinor: 3500,
		line: { eventId: "ev_clay", ticketTypeId: "tt_session" },
		...o,
	});

const settlePayload = (o = {}, cid = KEYS.A.cid) =>
	build(
		"settle",
		{ v: 1, typ: "settle", cid, rid: "rd_01JB7Q2M", ref: "BK7Q2M", outcome: "confirmed", creditMinor: 0, at: NOW - 30 },
		o,
	);

const lookupPayload = (o = {}, cid = KEYS.A.cid) =>
	build("lookup", { v: 1, typ: "lookup", cid, ts: NOW - 10, ref: "BK7Q2M", rid: "rd_01JB7Q2M" }, o);

const PAYLOAD = { hold: holdPayload, settle: settlePayload, lookup: lookupPayload };

/** Grows an unknown field until the minted token is exactly `targetLength` characters. */
async function mintToLength(prefix, base, targetLength) {
	for (let n = 0; n < targetLength; n++) {
		const payload = { ...base, pad: "x".repeat(n) };
		const segLen = Math.ceil((utf8.encode(JSON.stringify(payload)).length * 4) / 3);
		if (segLen + 1 + 43 === targetLength) return { payload, token: await mint(KEYS.A.bytes, prefix, payload) };
	}
	throw new Error(`cannot reach token length ${targetLength}`);
}

// ---------------------------------------------------------------------------------------------
// Vector builders

const vectors = [];

function add(type, name, description, input, verifier, expected) {
	vectors.push({ name: `${type}/${name}`, type, description, input, verifier, expected });
}

const ok = (payload) => ({ ok: true, payload });
const fail = (error) => ({ ok: false, error });

async function tokenVector(type, name, description, payload, expected, opts = {}) {
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
		VERIFIER[type](opts.now),
		expected,
	);
	return token;
}

function rawVector(type, name, description, token, expected, extra = {}) {
	add(type, name, description, { token, expectedPrefix: PREFIXES[type], ...extra }, VERIFIER[type](), expected);
}

async function signedRawVector(type, name, description, payloadBytes, expected) {
	const token = await signSegment(KEYS.A.bytes, PREFIXES[type], b64url(payloadBytes));
	rawVector(type, name, description, token, expected, {
		signedWithPrefix: PREFIXES[type],
		signedWithSecret: KEYS.A.secret,
	});
}

/** The vectors every token type has: authentication, structure and size. */
async function commonVectors(type, validToken, otherPrefix, otherName) {
	const base = PAYLOAD[type]();
	const [payloadB64, sig] = validToken.split(".");

	await tokenVector(
		type,
		"wrong-prefix",
		`Signed under ${otherPrefix}, presented as ${type}.`,
		base,
		fail("TOKEN_INVALID"),
		{
			prefix: otherPrefix,
		},
	);
	await tokenVector(
		type,
		"esign-prefix",
		"Signed under esign-intent/1 with the same secret: other protocols never verify.",
		base,
		fail("TOKEN_INVALID"),
		{ prefix: "esign-intent/1" },
	);
	const other = await mint(KEYS.A.bytes, PREFIXES[otherName], PAYLOAD[otherName]());
	rawVector(
		type,
		`${otherName}-token-presented`,
		`A genuine ${otherName} token presented as ${type}.`,
		other,
		fail("TOKEN_INVALID"),
		{
			signedWithPrefix: PREFIXES[otherName],
			signedWithSecret: KEYS.A.secret,
		},
	);

	const tampered = PAYLOAD[type]({ ref: "BK9ZZZ" });
	rawVector(
		type,
		"tampered-payload",
		"The payload segment was replaced (ref changed) and the original signature kept.",
		`${b64urlText(JSON.stringify(tampered))}.${sig}`,
		fail("TOKEN_INVALID"),
		{ signedWithPrefix: PREFIXES[type], signedWithSecret: KEYS.A.secret, payload: base, tamper: "payload replaced" },
	);
	await tokenVector(type, "tampered-signature", "One signature bit flipped.", base, fail("TOKEN_INVALID"), {
		transform: flipFirstSignatureBit,
		tamper: "first signature bit flipped",
	});
	await tokenVector(
		type,
		"wrong-secret",
		"cid is the paired client, signed with client B's secret.",
		base,
		fail("TOKEN_INVALID"),
		{
			key: KEYS.B,
		},
	);
	await tokenVector(
		type,
		"unknown-client",
		"cid is not paired.",
		PAYLOAD[type]({}, UNKNOWN_CID),
		fail("CLIENT_UNKNOWN"),
		{
			key: KEYS.B,
		},
	);
	await tokenVector(
		type,
		"typ-mismatch",
		`Signed under ${PREFIXES[type]} but typ is '${otherName}'.`,
		PAYLOAD[type]({ typ: otherName }),
		fail("PAYLOAD_INVALID"),
	);
	await tokenVector(type, "wrong-version", "v is 2.", PAYLOAD[type]({ v: 2 }), fail("PAYLOAD_INVALID"));

	rawVector(
		type,
		"malformed-padding",
		"Payload segment carries '=' padding.",
		`${payloadB64}=.${sig}`,
		fail("TOKEN_MALFORMED"),
	);
	rawVector(
		type,
		"malformed-noncanonical-signature",
		"Signature's last character has a non-zero padding bit.",
		`${payloadB64}.${nonCanonicalLastChar(sig)}`,
		fail("TOKEN_MALFORMED"),
	);
	rawVector(
		type,
		"malformed-standard-alphabet",
		"'+' from the standard base64 alphabet.",
		`+${payloadB64.slice(1)}.${sig}`,
		fail("TOKEN_MALFORMED"),
	);
	rawVector(type, "malformed-three-segments", "Three segments.", `${validToken}.${sig}`, fail("TOKEN_MALFORMED"));
	rawVector(type, "malformed-empty-payload", "Payload segment is empty.", `.${sig}`, fail("TOKEN_MALFORMED"));
	await signedRawVector(
		type,
		"malformed-not-json",
		"Signed payload is not JSON.",
		utf8.encode("hold me"),
		fail("TOKEN_MALFORMED"),
	);
	await signedRawVector(
		type,
		"malformed-bom",
		"Signed payload starts with a UTF-8 byte-order mark.",
		Uint8Array.of(0xef, 0xbb, 0xbf, ...utf8.encode(JSON.stringify(base))),
		fail("TOKEN_MALFORMED"),
	);
	await signedRawVector(
		type,
		"malformed-array",
		"Signed payload is a JSON array.",
		utf8.encode("[1]"),
		fail("TOKEN_MALFORMED"),
	);

	const big = await mintToLength(PREFIXES[type], base, MAX_TOKEN_LENGTH[type] + 2);
	add(
		type,
		"oversize",
		"1026 characters: over the 1024 limit, rejected before decoding.",
		{
			token: big.token,
			expectedPrefix: PREFIXES[type],
			signedWithPrefix: PREFIXES[type],
			signedWithSecret: KEYS.A.secret,
			payload: big.payload,
		},
		VERIFIER[type](),
		fail("TOKEN_TOO_LARGE"),
	);
	const max = await mintToLength(PREFIXES[type], base, MAX_TOKEN_LENGTH[type]);
	add(
		type,
		"max-length",
		"Exactly 1024 characters, with an unknown field: valid.",
		{
			token: max.token,
			expectedPrefix: PREFIXES[type],
			signedWithPrefix: PREFIXES[type],
			signedWithSecret: KEYS.A.secret,
			payload: max.payload,
		},
		VERIFIER[type](),
		ok(max.payload),
	);
}

async function holdVectors() {
	const t = "hold";
	const money = holdPayload();
	const valid = await tokenVector(t, "valid-money", "A money hold of 25.00 GBP.", money, ok(money));
	const activity = activityHold();
	await tokenVector(t, "valid-activity", "An activity hold for one clay session ticket.", activity, ok(activity));
	const free = activityHold({ rid: "rd_free", amountMinor: 0 });
	await tokenVector(t, "valid-activity-zero", "Activity holds may carry a zero unit price.", free, ok(free));
	const extra = holdPayload({
		amountMinor: MAX_MINOR,
		rid: "x".repeat(64),
		ref: `${"R".repeat(120)}:seat.01`.slice(0, 128),
		future: { anything: true },
	});
	await tokenVector(
		t,
		"valid-limits",
		"Largest amount, 64-character rid, 128-character ref and an unknown field.",
		extra,
		ok(extra),
	);
	const lineExtra = activityHold({ line: { eventId: "ev_clay", ticketTypeId: "tt_session", label: "Clay" } });
	await tokenVector(t, "valid-line-unknown-field", "Unknown fields inside line are ignored.", lineExtra, ok(lineExtra));

	await tokenVector(t, "at-expiry-boundary", "now = exp + 60: still valid.", money, ok(money), {
		now: money.exp + SKEW,
	});
	await tokenVector(t, "expired", "now = exp + 61.", money, fail("TOKEN_EXPIRED"), { now: money.exp + SKEW + 1 });
	const early = holdPayload({ iat: NOW + SKEW, exp: NOW + SKEW + 600 });
	await tokenVector(t, "iat-skew-boundary", "iat = now + 60: valid.", early, ok(early));
	await tokenVector(
		t,
		"not-yet-valid",
		"iat = now + 61.",
		holdPayload({ iat: NOW + SKEW + 1, exp: NOW + SKEW + 600 }),
		fail("TOKEN_NOT_YET_VALID"),
	);
	const longest = holdPayload({ iat: NOW - 60, exp: NOW - 60 + HOLD_MAX_LIFETIME });
	await tokenVector(t, "lifetime-max", "exp − iat = 1800: valid.", longest, ok(longest));
	await tokenVector(
		t,
		"lifetime-exceeded",
		"exp − iat = 1801.",
		holdPayload({ exp: NOW - 60 + HOLD_MAX_LIFETIME + 1 }),
		fail("TOKEN_LIFETIME_EXCEEDED"),
	);
	await tokenVector(
		t,
		"lifetime-after-schema",
		"Too long and an invalid currency: the schema failure wins.",
		holdPayload({ exp: NOW + 7200, currency: "gbp" }),
		fail("PAYLOAD_INVALID"),
	);

	const invalid = [
		["exp-not-after-iat", "exp = iat.", { exp: NOW - 60 }],
		[
			"money-with-line",
			"A money hold must not carry line.",
			{ line: { eventId: "ev_clay", ticketTypeId: "tt_session" } },
		],
		["money-zero", "A money hold of 0.", { amountMinor: 0 }],
		["amount-over-max", "amountMinor = 10000001.", { amountMinor: MAX_MINOR + 1 }],
		["amount-fraction", "amountMinor = 25.5.", { amountMinor: 25.5 }],
		["amount-string", "amountMinor is a string.", { amountMinor: "2500" }],
		["currency-lowercase", "currency must be upper case.", { currency: "gbp" }],
		["currency-long", "currency has four letters.", { currency: "GBPX" }],
		["bad-kind", "kind is not money or activity.", { kind: "gift" }],
		["bad-rid", "rid has a space.", { rid: "rd 1" }],
		["rid-too-long", "rid has 65 characters.", { rid: "x".repeat(65) }],
		["bad-ref", "ref has a slash.", { ref: "BK/7Q2M" }],
		["missing-ref", "ref is missing.", { ref: undefined }],
		["iat-negative", "iat is negative.", { iat: -1 }],
	];
	for (const [name, description, o] of invalid) {
		await tokenVector(t, name, description, holdPayload(o), fail("PAYLOAD_INVALID"));
	}
	const activityInvalid = [
		["activity-without-line", "An activity hold must carry line.", { line: undefined }],
		["activity-bad-line", "line.ticketTypeId is missing.", { line: { eventId: "ev_clay" } }],
		["activity-line-array", "line is an array.", { line: ["ev_clay", "tt_session"] }],
		["activity-negative", "amountMinor is negative.", { amountMinor: -1 }],
	];
	for (const [name, description, o] of activityInvalid) {
		await tokenVector(t, name, description, activityHold(o), fail("PAYLOAD_INVALID"));
	}

	await commonVectors(t, valid, PREFIXES.settle, "settle");
}

async function settleVectors() {
	const t = "settle";
	const confirmed = settlePayload();
	const valid = await tokenVector(
		t,
		"valid-confirmed",
		"The booking was confirmed with the voucher.",
		confirmed,
		ok(confirmed),
	);
	const released = settlePayload({ outcome: "released" });
	await tokenVector(t, "valid-released", "The booking will never use the hold.", released, ok(released));
	const credited = settlePayload({ outcome: "credited", creditMinor: 1500 });
	await tokenVector(t, "valid-credited", "15.00 credited back after a cancel.", credited, ok(credited));
	const old = settlePayload({ at: NOW - 400 * 86400 });
	await tokenVector(t, "old-never-expires", "Settled more than a year ago: settle tokens do not expire.", old, ok(old));
	const early = settlePayload({ at: NOW + SKEW });
	await tokenVector(t, "at-skew-boundary", "at = now + 60: valid.", early, ok(early));
	await tokenVector(
		t,
		"not-yet-valid",
		"at = now + 61.",
		settlePayload({ at: NOW + SKEW + 1 }),
		fail("TOKEN_NOT_YET_VALID"),
	);
	await tokenVector(
		t,
		"revoked-client",
		"Signed by a client revoked in Vouchers' admin.",
		settlePayload({}, KEYS.R.cid),
		fail("CLIENT_REVOKED"),
		{ key: KEYS.R },
	);
	const invalid = [
		["credited-zero", "credited needs creditMinor ≥ 1.", { outcome: "credited", creditMinor: 0 }],
		["confirmed-with-credit", "confirmed needs creditMinor = 0.", { creditMinor: 100 }],
		["released-with-credit", "released needs creditMinor = 0.", { outcome: "released", creditMinor: 100 }],
		["credit-over-max", "creditMinor = 10000001.", { outcome: "credited", creditMinor: MAX_MINOR + 1 }],
		["missing-credit", "creditMinor is missing.", { creditMinor: undefined }],
		["bad-outcome", "outcome is not one of the three.", { outcome: "refunded" }],
		["bad-at", "at is a string.", { at: "now" }],
	];
	for (const [name, description, o] of invalid) {
		await tokenVector(t, name, description, settlePayload(o), fail("PAYLOAD_INVALID"));
	}
	await commonVectors(t, valid, PREFIXES.hold, "hold");
}

async function lookupVectors() {
	const t = "lookup";
	const base = lookupPayload();
	const valid = await tokenVector(t, "valid", "Asks for the outcome of hold rd_01JB7Q2M on BK7Q2M.", base, ok(base));
	await tokenVector(t, "at-age-boundary", "now = ts + 300 + 60: still valid.", base, ok(base), {
		now: base.ts + REQUEST_MAX_AGE + SKEW,
	});
	await tokenVector(t, "expired", "now = ts + 361.", base, fail("TOKEN_EXPIRED"), {
		now: base.ts + REQUEST_MAX_AGE + SKEW + 1,
	});
	await tokenVector(
		t,
		"not-yet-valid",
		"ts = now + 61.",
		lookupPayload({ ts: NOW + SKEW + 1 }),
		fail("TOKEN_NOT_YET_VALID"),
	);
	await tokenVector(t, "missing-rid", "rid is missing.", lookupPayload({ rid: undefined }), fail("PAYLOAD_INVALID"));
	await tokenVector(t, "bad-ts", "ts has a fraction.", lookupPayload({ ts: NOW - 0.5 }), fail("PAYLOAD_INVALID"));
	await tokenVector(t, "esign-lookup-prefix", "Signed under esign-lookup/1.", base, fail("TOKEN_INVALID"), {
		prefix: "esign-lookup/1",
	});
	await commonVectors(t, valid, PREFIXES.hold, "hold");
}

function pairingVectors() {
	const t = "pairing";
	const p = (name, description, pairing, expected) => add(t, name, description, { pairing }, undefined, expected);
	const bad = { ok: false, error: "PAIRING_MALFORMED" };
	const { cid, secret, pairing } = KEYS.A;
	p("valid", "voucher1.<clientId>.<43-character base64url secret>.", pairing, { ok: true, clientId: cid, secret });
	p("esign-pairing", "An e-sign pairing string is not a voucher pairing.", `esign1.${cid}.${secret}`, bad);
	p("wrong-version", "Unknown pairing version.", pairing.replace("voucher1.", "voucher2."), bad);
	p("missing-secret", "Only two segments.", `voucher1.${cid}`, bad);
	p("short-secret", "Secret decodes to 31 bytes.", `voucher1.${cid}.${b64url(KEYS.A.bytes.slice(0, 31))}`, bad);
	p("padded-secret", "Secret carries '=' padding.", `${pairing}=`, bad);
	p(
		"noncanonical-secret",
		"Secret's last character has a non-zero padding bit.",
		`voucher1.${cid}.${nonCanonicalLastChar(secret)}`,
		bad,
	);
	p("bad-client-id", "clientId has three characters.", `voucher1.cl_.${secret}`, bad);
	p("surrounding-whitespace", "Parsers do not trim.", ` ${pairing}\n`, bad);
}

// ---------------------------------------------------------------------------------------------
// Codes (§7)

/** 10 bytes → 16 Crockford base32 characters, most significant bits first. */
function encodeCode(bytes) {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += CODE_ALPHABET[(value >> bits) & 31];
		}
		value &= (1 << bits) - 1;
	}
	return out;
}

/** The inverse of encodeCode, for building generation vectors from a chosen code. */
function decodeCode(code) {
	const bytes = [];
	let bits = 0;
	let value = 0;
	for (const char of code) {
		value = (value << 5) | CODE_ALPHABET.indexOf(char);
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((value >> bits) & 0xff);
			value &= (1 << bits) - 1;
		}
	}
	return Uint8Array.from(bytes);
}

const display = (code) => code.match(/.{4}/g).join("-");
const codeId = async (code) => hex(new Uint8Array(await subtle.digest("SHA-256", utf8.encode(code))));

async function codeVectors() {
	const t = "code";
	const gen = (name, description, bytes) =>
		add(t, name, description, { bytes: hex(bytes) }, undefined, { ok: true, code: encodeCode(bytes) });
	gen("generate-zero", "Ten zero bytes.", new Uint8Array(10));
	gen("generate-ones", "Ten 0xff bytes: the last symbol, Z, everywhere.", new Uint8Array(10).fill(0xff));
	gen(
		"generate-sequence",
		"Bytes 00 11 22 … 99.",
		Uint8Array.from({ length: 10 }, (_, i) => i * 0x11),
	);
	gen("generate-alphabet-low", "The first 16 symbols in order.", decodeCode("0123456789ABCDEF"));
	gen("generate-alphabet-high", "The last 16 symbols in order.", decodeCode("GHJKMNPQRSTVWXYZ"));

	const CODE = encodeCode(Uint8Array.from([0x5a, 0x3c, 0x01, 0xfe, 0x77, 0x10, 0xab, 0xcd, 0x09, 0x42]));
	const good = async (name, description, text, code = CODE) =>
		add(t, name, description, { text }, undefined, { ok: true, code, display: display(code), id: await codeId(code) });
	const bad = (name, description, text) => add(t, name, description, { text }, undefined, { ok: false });

	await good("canonical", "The canonical 16-character code.", CODE);
	await good("display", "The grouped display form.", display(CODE));
	await good("lowercase", "Lower case.", display(CODE).toLowerCase());
	await good(
		"spaces",
		"Spaces, a tab and a line feed instead of dashes.",
		`${CODE.slice(0, 4)} ${CODE.slice(4, 8)}\t${CODE.slice(8, 12)}\n${CODE.slice(12)}`,
	);
	await good("confusables", "O for 0, I and l for 1.", "O1IL-0000-0000-000l", "0111000000000001");
	await good("surrounding", "Leading and trailing spaces and dashes.", ` -${CODE}- `);
	bad("too-short", "15 characters.", CODE.slice(0, 15));
	bad("too-long", "17 characters.", `${CODE}0`);
	bad("letter-u", "U is not in the alphabet.", `U${CODE.slice(1)}`);
	bad("punctuation", "A dot is not a separator.", `${CODE.slice(0, 8)}.${CODE.slice(8)}`);
	bad("non-ascii", "A dotless ı would upper-case to I; non-ASCII is refused first.", `ı${CODE.slice(1)}`);
	bad("over-64", "More than 64 characters, even if mostly separators.", `${CODE}${"-".repeat(49)}`);
	bad("empty", "Empty.", "");
}

// ---------------------------------------------------------------------------------------------

await holdVectors();
await settleVectors();
await lookupVectors();
pairingVectors();
await codeVectors();

const doc = {
	protocol: "voucher/1",
	spec: "docs/protocol/voucher-v1.md",
	generator: "docs/protocol/generate-voucher-vectors.mjs",
	note: "Generated file. Do not edit by hand; change the generator and re-run it. Secrets here are test keys only.",
	constants: {
		prefixes: PREFIXES,
		maxTokenLength: MAX_TOKEN_LENGTH,
		clockSkewSeconds: SKEW,
		holdMaxLifetimeSeconds: HOLD_MAX_LIFETIME,
		requestMaxAgeSeconds: REQUEST_MAX_AGE,
		maxMinor: MAX_MINOR,
		codeAlphabet: CODE_ALPHABET,
	},
	errorCodes: ERROR_CODES,
	keys: Object.fromEntries(
		Object.entries(KEYS).map(([id, k]) => [id, { cid: k.cid, secret: k.secret, pairing: k.pairing, role: k.role }]),
	),
	vectors,
};

const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "voucher-vectors.json");
writeFileSync(out, `${JSON.stringify(doc, null, "\t")}\n`);
