// Checks docs/protocol/vectors.json against the esign-intent/1 spec (SX-NFR-01..06).
// Run: node --test docs/protocol/vectors.test.mjs
//
// This is not a reference verifier (that is T012, packages/shared). It proves that the vectors are
// well-formed, reproducible byte for byte, and internally consistent: every "ok" vector carries a
// valid HMAC, every signature-failure vector does not, and every other failure has a valid HMAC so
// that it fails for the reason it claims.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = join(here, "vectors.json");
const generatorPath = join(here, "generate-vectors.mjs");
const specPath = join(here, "esign-intent-v1.md");

const TOKEN_TYPES = ["intent", "receipt", "lookup", "catalog"];
const PREFIXES = {
	intent: "esign-intent/1",
	receipt: "esign-receipt/1",
	lookup: "esign-lookup/1",
	catalog: "esign-catalog/1",
};
const MAX_TOKEN_LENGTH = { intent: 8192, receipt: 2048, lookup: 1024, catalog: 1024 };
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
// Failures decided before or by the HMAC check: the signature need not (or must not) verify.
const PRE_SIGNATURE_ERRORS = new Set([
	"TOKEN_TOO_LARGE",
	"TOKEN_MALFORMED",
	"CLIENT_UNKNOWN",
	"CLIENT_REVOKED",
	"TOKEN_INVALID",
]);
const B64URL = /^[A-Za-z0-9_-]*$/;

function loadVectors() {
	return JSON.parse(readFileSync(vectorsPath, "utf8"));
}

function b64urlDecode(s) {
	assert.match(s, B64URL);
	return new Uint8Array(Buffer.from(s, "base64url"));
}

/** Splits a token if it is structurally a token; returns null otherwise. */
function splitToken(token) {
	const parts = token.split(".");
	if (parts.length !== 2 || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) return null;
	if (parts[0] === "" || parts[1].length !== 43) return null;
	return { payloadB64: parts[0], sigB64: parts[1] };
}

function decodePayload(payloadB64) {
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(b64urlDecode(payloadB64));
		const value = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}

async function hmacVerifies(secretB64, prefix, payloadB64, sigB64) {
	const key = await crypto.subtle.importKey(
		"raw",
		b64urlDecode(secretB64),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify(
		"HMAC",
		key,
		b64urlDecode(sigB64),
		new TextEncoder().encode(`${prefix}.${payloadB64}`),
	);
}

test("SX-NFR-01: vectors.json is well-formed with an expected outcome for every vector", () => {
	const doc = loadVectors();
	assert.equal(doc.protocol, "esign-intent/1");
	assert.deepEqual(doc.constants.prefixes, PREFIXES);
	assert.deepEqual(doc.constants.maxTokenLength, MAX_TOKEN_LENGTH);
	assert.equal(doc.constants.clockSkewSeconds, 60);
	assert.equal(doc.constants.intentMaxLifetimeSeconds, 1800);
	assert.equal(doc.constants.requestMaxAgeSeconds, 300);
	assert.deepEqual(doc.errorCodes, ERROR_CODES);
	assert.ok(Array.isArray(doc.vectors));

	const names = new Set();
	for (const v of doc.vectors) {
		assert.equal(typeof v.name, "string");
		assert.match(v.name, /^(intent|receipt|lookup|catalog|pairing)\/[a-z0-9-]+$/, v.name);
		assert.ok(!names.has(v.name), `duplicate vector name ${v.name}`);
		names.add(v.name);
		assert.equal(v.name.split("/")[0], v.type, `${v.name}: name prefix matches type`);
		assert.equal(typeof v.description, "string", `${v.name}: description`);
		assert.ok(v.description.length > 0);
		assert.equal(typeof v.expected?.ok, "boolean", `${v.name}: expected.ok`);
		if (v.expected.ok) {
			assert.equal(v.expected.error, undefined, `${v.name}: ok vectors carry no error`);
		} else {
			assert.ok(ERROR_CODES.includes(v.expected.error), `${v.name}: known error code`);
		}

		if (v.type === "pairing") {
			assert.equal(typeof v.input.pairing, "string", `${v.name}: input.pairing`);
			if (v.expected.ok) {
				assert.equal(typeof v.expected.clientId, "string");
				assert.equal(typeof v.expected.secret, "string");
				assert.equal(b64urlDecode(v.expected.secret).length, 32);
			} else {
				assert.equal(v.expected.error, "PAIRING_MALFORMED", v.name);
			}
			continue;
		}

		assert.ok(TOKEN_TYPES.includes(v.type), `${v.name}: type`);
		assert.equal(typeof v.input.token, "string", `${v.name}: input.token`);
		assert.equal(v.input.expectedPrefix, PREFIXES[v.type], `${v.name}: expectedPrefix`);
		const ver = v.verifier;
		assert.ok(Number.isSafeInteger(ver?.now), `${v.name}: verifier.now`);
		assert.equal(typeof ver.clients, "object", `${v.name}: verifier.clients`);
		for (const [cid, c] of Object.entries(ver.clients)) {
			assert.equal(b64urlDecode(c.secret).length, 32, `${v.name}: ${cid} secret is 32 bytes`);
			assert.equal(typeof c.revoked, "boolean", `${v.name}: ${cid} revoked`);
			if (v.type === "intent") assert.ok(Array.isArray(c.returnUrlAllowlist), `${v.name}: allowlist`);
		}
		assert.ok(Array.isArray(ver.usedNonces), `${v.name}: verifier.usedNonces`);
		for (const n of ver.usedNonces) {
			assert.equal(typeof n.cid, "string");
			assert.equal(typeof n.nonce, "string");
		}
		if (v.expected.ok) {
			assert.equal(typeof v.expected.payload, "object", `${v.name}: expected.payload`);
		} else {
			assert.notEqual(v.expected.error, "PAIRING_MALFORMED", v.name);
		}
	}
});

test("SX-NFR-01: at least 20 vectors, at least 4 per token type, covering every failure class", () => {
	const { vectors } = loadVectors();
	assert.ok(vectors.length >= 20, `only ${vectors.length} vectors`);
	for (const type of TOKEN_TYPES) {
		const ofType = vectors.filter((v) => v.type === type);
		assert.ok(ofType.length >= 4, `${type}: only ${ofType.length} vectors`);
		assert.ok(ofType.some((v) => v.expected.ok), `${type}: has a valid vector`);
		for (const code of ["TOKEN_INVALID", "TOKEN_MALFORMED", "TOKEN_TOO_LARGE", "CLIENT_UNKNOWN"]) {
			assert.ok(
				ofType.some((v) => v.expected.error === code),
				`${type}: has a ${code} vector`,
			);
		}
	}
	const codes = new Set(vectors.map((v) => v.expected.error).filter(Boolean));
	for (const code of ERROR_CODES) assert.ok(codes.has(code), `some vector expects ${code}`);
	// Cross-type confusion: a token minted under another prefix is presented to each verifier.
	for (const type of TOKEN_TYPES) {
		assert.ok(
			vectors.some(
				(v) =>
					v.type === type && v.input.signedWithPrefix && v.input.signedWithPrefix !== PREFIXES[type],
			),
			`${type}: has a wrong-prefix vector`,
		);
	}
});

test("SX-NFR-02: vectors are internally consistent with HMAC-SHA256 over '<prefix>.<payloadB64>'", async () => {
	const { vectors } = loadVectors();
	for (const v of vectors) {
		if (v.type === "pairing") continue;
		const { token, expectedPrefix } = v.input;
		const err = v.expected.error;
		if (v.expected.ok || !PRE_SIGNATURE_ERRORS.has(err)) {
			// Passed (or got past) the signature check: token is in bounds, well-formed and signed.
			assert.ok(token.length <= MAX_TOKEN_LENGTH[v.type], `${v.name}: within max length`);
			const parts = splitToken(token);
			assert.ok(parts, `${v.name}: structurally valid`);
			const payload = decodePayload(parts.payloadB64);
			assert.ok(payload, `${v.name}: payload is a JSON object`);
			const client = v.verifier.clients[payload.cid];
			assert.ok(client, `${v.name}: verifier knows cid ${payload.cid}`);
			assert.equal(client.revoked, false, `${v.name}: client not revoked`);
			assert.ok(
				await hmacVerifies(client.secret, expectedPrefix, parts.payloadB64, parts.sigB64),
				`${v.name}: signature verifies`,
			);
			if (v.expected.ok) assert.deepEqual(payload, v.expected.payload, `${v.name}: payload`);
		}
		if (err === "TOKEN_INVALID") {
			const parts = splitToken(token);
			assert.ok(parts, `${v.name}: structurally valid`);
			const payload = decodePayload(parts.payloadB64);
			const client = v.verifier.clients[payload?.cid];
			assert.ok(client && !client.revoked, `${v.name}: reaches the signature check`);
			assert.equal(
				await hmacVerifies(client.secret, expectedPrefix, parts.payloadB64, parts.sigB64),
				false,
				`${v.name}: signature must not verify`,
			);
		}
		if (err === "TOKEN_TOO_LARGE") {
			assert.ok(token.length > MAX_TOKEN_LENGTH[v.type], `${v.name}: over max length`);
		}
	}
});

test("SX-NFR-03: the spec documents every error code and prefix used by the vectors", () => {
	const spec = readFileSync(specPath, "utf8");
	for (const code of ERROR_CODES) assert.ok(spec.includes(`\`${code}\``), `spec lists ${code}`);
	for (const prefix of Object.values(PREFIXES)) assert.ok(spec.includes(prefix), `spec names ${prefix}`);
});

test("SX-NFR-01: re-running the generator reproduces vectors.json byte for byte", () => {
	const dir = mkdtempSync(join(tmpdir(), "esign-vectors-"));
	try {
		const out = join(dir, "vectors.json");
		execFileSync(process.execPath, [generatorPath, out], { stdio: "pipe" });
		const first = readFileSync(out);
		execFileSync(process.execPath, [generatorPath, out], { stdio: "pipe" });
		assert.ok(readFileSync(out).equals(first), "generator output is stable across runs");
		assert.ok(first.equals(readFileSync(vectorsPath)), "committed vectors.json is up to date");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
