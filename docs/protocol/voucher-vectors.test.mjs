// Checks docs/protocol/voucher-vectors.json against the voucher/1 spec (T164).
// Run: node --test docs/protocol/voucher-vectors.test.mjs
//
// Not a reference verifier (that is packages/shared/src/voucher.ts, run against these vectors by its own
// tests). This proves the vectors are well-formed, reproducible byte for byte and internally consistent:
// every "ok" vector carries a valid HMAC, every signature failure does not, and every later failure is
// signed so that it fails for the reason it claims.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = join(here, "voucher-vectors.json");
const generatorPath = join(here, "generate-voucher-vectors.mjs");
const specPath = join(here, "voucher-v1.md");

const TOKEN_TYPES = ["hold", "settle", "lookup"];
const PREFIXES = { hold: "voucher-hold/1", settle: "voucher-settle/1", lookup: "voucher-lookup/1" };
const MAX_TOKEN_LENGTH = { hold: 1024, settle: 1024, lookup: 1024 };
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
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
const VOUCHER_CODES = [
	"VOUCHER_INVALID",
	"VOUCHER_NO_BALANCE",
	"VOUCHER_WRONG_ACTIVITY",
	"VOUCHER_CURRENCY",
	"VOUCHER_UNAVAILABLE",
];
const PRE_SIGNATURE_ERRORS = new Set([
	"TOKEN_TOO_LARGE",
	"TOKEN_MALFORMED",
	"CLIENT_UNKNOWN",
	"CLIENT_REVOKED",
	"TOKEN_INVALID",
]);
const B64URL = /^[A-Za-z0-9_-]*$/;

const loadVectors = () => JSON.parse(readFileSync(vectorsPath, "utf8"));

function b64urlDecode(s) {
	assert.match(s, B64URL);
	return new Uint8Array(Buffer.from(s, "base64url"));
}

function splitToken(token) {
	const parts = token.split(".");
	if (parts.length !== 2 || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) return null;
	if (parts[0] === "" || parts[1].length !== 43) return null;
	return { payloadB64: parts[0], sigB64: parts[1] };
}

function decodePayload(payloadB64) {
	try {
		const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64urlDecode(payloadB64)));
		return value && typeof value === "object" && !Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}

async function hmacVerifies(secretB64, prefix, payloadB64, sigB64) {
	const key = await crypto.subtle.importKey("raw", b64urlDecode(secretB64), { name: "HMAC", hash: "SHA-256" }, false, [
		"verify",
	]);
	return crypto.subtle.verify("HMAC", key, b64urlDecode(sigB64), new TextEncoder().encode(`${prefix}.${payloadB64}`));
}

/** An independent bit-string decoding: 16 symbols → 80 bits → 10 bytes. */
function codeToHex(code) {
	const bits = [...code].map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, "0")).join("");
	return (bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2).toString(16).padStart(2, "0")).join("");
}

test("T164: voucher-vectors.json is well-formed with an expected outcome for every vector", () => {
	const doc = loadVectors();
	assert.equal(doc.protocol, "voucher/1");
	assert.deepEqual(doc.constants.prefixes, PREFIXES);
	assert.deepEqual(doc.constants.maxTokenLength, MAX_TOKEN_LENGTH);
	assert.equal(doc.constants.clockSkewSeconds, 60);
	assert.equal(doc.constants.holdMaxLifetimeSeconds, 1800);
	assert.equal(doc.constants.requestMaxAgeSeconds, 300);
	assert.equal(doc.constants.maxMinor, 10_000_000);
	assert.equal(doc.constants.codeAlphabet, ALPHABET);
	assert.deepEqual(doc.errorCodes, ERROR_CODES);

	const names = new Set();
	for (const v of doc.vectors) {
		assert.match(v.name, /^(hold|settle|lookup|pairing|code)\/[a-z0-9-]+$/, v.name);
		assert.ok(!names.has(v.name), `duplicate vector name ${v.name}`);
		names.add(v.name);
		assert.equal(v.name.split("/")[0], v.type, `${v.name}: name prefix matches type`);
		assert.ok(typeof v.description === "string" && v.description.length > 0, `${v.name}: description`);
		assert.equal(typeof v.expected?.ok, "boolean", `${v.name}: expected.ok`);
		if (v.type === "code") continue;
		if (!v.expected.ok) assert.ok(ERROR_CODES.includes(v.expected.error), `${v.name}: known error code`);
		if (v.type === "pairing") {
			assert.equal(typeof v.input.pairing, "string");
			if (v.expected.ok) assert.equal(b64urlDecode(v.expected.secret).length, 32);
			else assert.equal(v.expected.error, "PAIRING_MALFORMED");
			continue;
		}
		assert.ok(TOKEN_TYPES.includes(v.type), `${v.name}: type`);
		assert.equal(typeof v.input.token, "string", `${v.name}: input.token`);
		assert.equal(v.input.expectedPrefix, PREFIXES[v.type], `${v.name}: expectedPrefix`);
		assert.ok(Number.isSafeInteger(v.verifier?.now), `${v.name}: verifier.now`);
		for (const [cid, c] of Object.entries(v.verifier.clients)) {
			assert.equal(b64urlDecode(c.secret).length, 32, `${v.name}: ${cid} secret is 32 bytes`);
			assert.equal(typeof c.revoked, "boolean", `${v.name}: ${cid} revoked`);
		}
		if (v.expected.ok) assert.equal(typeof v.expected.payload, "object", `${v.name}: expected.payload`);
		else assert.notEqual(v.expected.error, "PAIRING_MALFORMED", v.name);
	}
});

test("T164: every token type has valid, expired or old, wrong-prefix, tampered, wrong-client and malformed vectors", () => {
	const { vectors } = loadVectors();
	for (const type of TOKEN_TYPES) {
		const ofType = vectors.filter((v) => v.type === type);
		assert.ok(
			ofType.some((v) => v.expected.ok),
			`${type}: valid`,
		);
		for (const code of ["TOKEN_INVALID", "TOKEN_MALFORMED", "TOKEN_TOO_LARGE", "CLIENT_UNKNOWN", "PAYLOAD_INVALID"]) {
			assert.ok(
				ofType.some((v) => v.expected.error === code),
				`${type}: has a ${code} vector`,
			);
		}
		assert.ok(
			ofType.some((v) => v.input.signedWithPrefix && v.input.signedWithPrefix !== PREFIXES[type]),
			`${type}: wrong prefix`,
		);
		assert.ok(
			ofType.some((v) => v.input.tamper),
			`${type}: tampered`,
		);
		assert.ok(
			ofType.some(
				(v) =>
					v.expected.error === "TOKEN_INVALID" &&
					v.input.signedWithSecret !== v.verifier.clients[decodePayload(v.input.token.split(".")[0])?.cid]?.secret,
			),
			`${type}: wrong client secret`,
		);
	}
	for (const type of ["hold", "lookup"]) {
		assert.ok(
			vectors.some((v) => v.type === type && v.expected.error === "TOKEN_EXPIRED"),
			`${type}: expired`,
		);
	}
	assert.ok(vectors.some((v) => v.name === "settle/old-never-expires" && v.expected.ok));
	const codes = new Set(vectors.map((v) => v.expected.error).filter(Boolean));
	for (const code of ERROR_CODES) assert.ok(codes.has(code), `some vector expects ${code}`);
});

test("T164: vectors are consistent with HMAC-SHA256 over '<prefix>.<payloadB64>'", async () => {
	const { vectors } = loadVectors();
	for (const v of vectors.filter((x) => TOKEN_TYPES.includes(x.type))) {
		const { token, expectedPrefix } = v.input;
		const err = v.expected.error;
		if (v.expected.ok || !PRE_SIGNATURE_ERRORS.has(err)) {
			assert.ok(token.length <= MAX_TOKEN_LENGTH[v.type], `${v.name}: within max length`);
			const parts = splitToken(token);
			assert.ok(parts, `${v.name}: structurally valid`);
			const payload = decodePayload(parts.payloadB64);
			assert.ok(payload, `${v.name}: payload is a JSON object`);
			const client = v.verifier.clients[payload.cid];
			assert.ok(client && !client.revoked, `${v.name}: active client ${payload.cid}`);
			assert.ok(
				await hmacVerifies(client.secret, expectedPrefix, parts.payloadB64, parts.sigB64),
				`${v.name}: signature verifies`,
			);
			if (v.expected.ok) assert.deepEqual(payload, v.expected.payload, `${v.name}: payload`);
		}
		if (err === "TOKEN_INVALID") {
			const parts = splitToken(token);
			const client = v.verifier.clients[decodePayload(parts.payloadB64)?.cid];
			assert.ok(client && !client.revoked, `${v.name}: reaches the signature check`);
			assert.equal(
				await hmacVerifies(client.secret, expectedPrefix, parts.payloadB64, parts.sigB64),
				false,
				`${v.name}: signature must not verify`,
			);
		}
		if (err === "TOKEN_TOO_LARGE") assert.ok(token.length > MAX_TOKEN_LENGTH[v.type], `${v.name}: over max length`);
	}
});

test("T164: code vectors agree with an independent encoding and SHA-256", () => {
	const { vectors } = loadVectors();
	const codes = vectors.filter((v) => v.type === "code");
	assert.ok(codes.some((v) => v.input.bytes) && codes.some((v) => v.input.text !== undefined && !v.expected.ok));
	const seen = new Set();
	for (const v of codes) {
		if (v.input.bytes !== undefined) {
			assert.match(v.input.bytes, /^[0-9a-f]{20}$/, v.name);
			assert.equal(codeToHex(v.expected.code), v.input.bytes, `${v.name}: code decodes to its bytes`);
			for (const c of v.expected.code) seen.add(c);
			continue;
		}
		if (!v.expected.ok) continue;
		const { code, display, id } = v.expected;
		assert.match(code, /^[0-9A-HJKMNP-TV-Z]{16}$/, v.name);
		assert.equal(display, code.match(/.{4}/g).join("-"), `${v.name}: display`);
		assert.equal(id, createHash("sha256").update(code).digest("hex"), `${v.name}: id`);
	}
	assert.equal([...seen].sort().join(""), ALPHABET, "generation vectors use every symbol");
});

test("T164: the spec documents every prefix and error code, with the voucher route codes", () => {
	const spec = readFileSync(specPath, "utf8");
	for (const code of [...ERROR_CODES, ...VOUCHER_CODES]) assert.ok(spec.includes(`\`${code}\``), `spec lists ${code}`);
	for (const prefix of Object.values(PREFIXES)) assert.ok(spec.includes(prefix), `spec names ${prefix}`);
	assert.ok(spec.includes(ALPHABET), "spec gives the code alphabet");
});

test("T164: re-running the generator reproduces voucher-vectors.json byte for byte", () => {
	const dir = mkdtempSync(join(tmpdir(), "voucher-vectors-"));
	try {
		const out = join(dir, "voucher-vectors.json");
		execFileSync(process.execPath, [generatorPath, out], { stdio: "pipe" });
		const first = readFileSync(out);
		execFileSync(process.execPath, [generatorPath, out], { stdio: "pipe" });
		assert.ok(readFileSync(out).equals(first), "generator output is stable across runs");
		assert.ok(first.equals(readFileSync(vectorsPath)), "committed voucher-vectors.json is up to date");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
