/**
 * esign-intent/1 compact tokens: `payloadB64 "." base64url(HMAC-SHA256(secret, prefix "." payloadB64))`.
 *
 * Implements docs/protocol/esign-intent-v1.md exactly (§2 encoding, §4 format, §5 schemas, §6
 * verification order, §7 return URL allowlist). The verification steps run in the spec's normative
 * order and the first failure is the result, so every implementation reports the same code.
 *
 * Web Crypto only; time and storage are injected. Nothing here logs, and no error carries token or
 * secret material.
 */
import { err, ok, type Result } from "./result";
import { constantTimeEqual } from "./tokens";

export type EsignTokenType = "intent" | "receipt" | "lookup" | "catalog";

/** HMAC domain-separation prefix per token type (§4). A verifier picks it from the route, never the payload. */
export const ESIGN_PREFIXES = Object.freeze({
	intent: "esign-intent/1",
	receipt: "esign-receipt/1",
	lookup: "esign-lookup/1",
	catalog: "esign-catalog/1",
} as const satisfies Record<EsignTokenType, string>);

/** Max token length in characters per type (§4). */
export const ESIGN_MAX_TOKEN_LENGTH = Object.freeze({
	intent: 8192,
	receipt: 2048,
	lookup: 1024,
	catalog: 1024,
} as const satisfies Record<EsignTokenType, number>);

/** Clock-skew allowance `S` (§6.1). */
export const ESIGN_CLOCK_SKEW_SECONDS = 60;
/** Longest intent lifetime, `exp − iat` (§6.1). */
export const ESIGN_INTENT_MAX_LIFETIME_SECONDS = 1800;
/** Request max age `A` for lookup and catalog requests (§6.1). */
export const ESIGN_REQUEST_MAX_AGE_SECONDS = 300;
/** Size of a client secret and of a signature (HMAC-SHA256 output). */
export const ESIGN_SECRET_BYTES = 32;

/** The §3 `clientId` grammar. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

/** Every code token verification can return (§9, minus the settings-only `PAIRING_MALFORMED`). */
export type EsignTokenError =
	| "TOKEN_TOO_LARGE"
	| "TOKEN_MALFORMED"
	| "CLIENT_UNKNOWN"
	| "CLIENT_REVOKED"
	| "TOKEN_INVALID"
	| "PAYLOAD_INVALID"
	| "TOKEN_LIFETIME_EXCEEDED"
	| "TOKEN_NOT_YET_VALID"
	| "TOKEN_EXPIRED"
	| "RETURN_URL_NOT_ALLOWED"
	| "TOKEN_REPLAYED";

export type SchemaError = "PAYLOAD_INVALID" | "TOKEN_LIFETIME_EXCEEDED";

// --- payloads (§5). Unknown fields are ignored on verify and preserved in the returned payload. ---

interface PayloadBase<T extends EsignTokenType> {
	readonly v: 1;
	readonly typ: T;
	readonly cid: string;
}

export interface IntentPayload extends PayloadBase<"intent"> {
	readonly iat: number;
	readonly exp: number;
	readonly nonce: string;
	readonly tpl: string;
	readonly tplVersion?: number;
	readonly ref: string;
	readonly signer: { readonly name: string; readonly email: string };
	/** Absent means `"self"`; the consumer applies the default. */
	readonly as?: "self" | "guardian" | "buyer";
	/** Present iff `as === "guardian"`. */
	readonly participant?: { readonly name: string };
	/** Absent means `"inline"`; the consumer applies the default. */
	readonly delivery?: "inline" | "email";
	readonly prefill: Readonly<Record<string, string>>;
	readonly returnUrl: string;
}

export type ReceiptStatus = "completed" | "declined" | "voided" | "expired";

export interface ReceiptPayload extends PayloadBase<"receipt"> {
	readonly envelopeId: string;
	readonly ref: string;
	readonly status: ReceiptStatus;
	readonly docSha256: string;
	readonly pdfSha256: string | null;
	readonly finalHash: string | null;
	readonly at: number;
}

export interface LookupPayload extends PayloadBase<"lookup"> {
	readonly ts: number;
	readonly ref: string;
}

export interface CatalogPayload extends PayloadBase<"catalog"> {
	readonly ts: number;
}

export interface EsignPayloads {
	intent: IntentPayload;
	receipt: ReceiptPayload;
	lookup: LookupPayload;
	catalog: CatalogPayload;
}

// --- base64url (§2.1) ---

const B64URL = /^[A-Za-z0-9_-]*$/;
const utf8 = new TextEncoder();

/** RFC 4648 §5 base64url without padding. */
export function encodeBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Strict canonical base64url decoding: only the URL-safe alphabet, no padding, no length ≡ 1 mod 4,
 * and zero unused low bits. Returns `undefined` for anything else.
 */
export function decodeBase64Url(text: string): Uint8Array | undefined {
	if (!B64URL.test(text) || text.length % 4 === 1) return undefined;
	const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return encodeBase64Url(bytes) === text ? bytes : undefined;
}

// --- HMAC ---

async function hmacKey(secret: Uint8Array): Promise<CryptoKey> {
	if (secret.length !== ESIGN_SECRET_BYTES) throw new Error(`Client secret must be ${ESIGN_SECRET_BYTES} bytes.`);
	return crypto.subtle.importKey("raw", new Uint8Array(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function signature(secret: Uint8Array, prefix: string, payloadB64: string): Promise<string> {
	const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8.encode(`${prefix}.${payloadB64}`));
	return encodeBase64Url(new Uint8Array(mac));
}

// --- schema helpers (§2.2, §5) ---

type Obj = Record<string, unknown>;

const ID64 = /^[A-Za-z0-9_-]{1,64}$/;
const REF = /^[A-Za-z0-9._:-]{1,128}$/;
const HEX256 = /^[0-9a-f]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const PREFILL_KEY = /^[A-Za-z0-9_]{1,64}$/;
/** With the `u` flag, a surrogate range only matches unpaired (lone) surrogates. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the spec forbids these characters.
const NAME_FORBIDDEN = /[\u0000-\u001F\u007F]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the spec forbids these characters.
const EMAIL_FORBIDDEN = /[\u0000- \u007F]/;
const PREFILL_MAX_MEMBERS = 32;

function isObject(value: unknown): value is Obj {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codePoints(text: string): number {
	let count = 0;
	for (const _ of text) count++;
	return count;
}

/** A well-formed string of `min..max` code points. */
function isText(value: unknown, min: number, max: number): value is string {
	if (typeof value !== "string" || LONE_SURROGATE.test(value)) return false;
	const length = codePoints(value);
	return length >= min && length <= max;
}

function matches(value: unknown, pattern: RegExp): value is string {
	return typeof value === "string" && pattern.test(value);
}

function isTime(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isName(value: unknown): boolean {
	return isText(value, 1, 200) && !NAME_FORBIDDEN.test(value);
}

function isEmail(value: unknown): boolean {
	if (!isText(value, 1, 254) || EMAIL_FORBIDDEN.test(value)) return false;
	const parts = value.split("@");
	return parts.length === 2 && parts[0] !== "" && parts[1] !== "";
}

function isPrefill(value: unknown): boolean {
	if (!isObject(value)) return false;
	const entries = Object.entries(value);
	return (
		entries.length <= PREFILL_MAX_MEMBERS &&
		entries.every(([key, text]) => PREFILL_KEY.test(key) && isText(text, 0, 500))
	);
}

function hasNamedObject(value: unknown): boolean {
	return isObject(value) && isName(value.name);
}

function validIntent(p: Obj): boolean {
	const guardian = p.as === "guardian";
	return (
		isTime(p.iat) &&
		isTime(p.exp) &&
		p.exp > p.iat &&
		matches(p.nonce, NONCE) &&
		matches(p.tpl, ID64) &&
		(p.tplVersion === undefined || (Number.isSafeInteger(p.tplVersion) && (p.tplVersion as number) >= 1)) &&
		matches(p.ref, REF) &&
		isObject(p.signer) &&
		isName(p.signer.name) &&
		isEmail(p.signer.email) &&
		(p.as === undefined || p.as === "self" || guardian || p.as === "buyer") &&
		(guardian ? hasNamedObject(p.participant) : !Object.hasOwn(p, "participant")) &&
		(p.delivery === undefined || p.delivery === "inline" || p.delivery === "email") &&
		isPrefill(p.prefill) &&
		isText(p.returnUrl, 1, 2048)
	);
}

const TERMINAL: ReadonlySet<unknown> = new Set(["completed", "declined", "voided", "expired"]);

function validReceipt(p: Obj): boolean {
	const completed = p.status === "completed";
	return (
		matches(p.envelopeId, ID64) &&
		matches(p.ref, REF) &&
		TERMINAL.has(p.status) &&
		matches(p.docSha256, HEX256) &&
		(completed ? p.pdfSha256 === null || matches(p.pdfSha256, HEX256) : p.pdfSha256 === null) &&
		(completed ? matches(p.finalHash, HEX256) : p.finalHash === null) &&
		isTime(p.at)
	);
}

const TYPE_FIELDS: Record<EsignTokenType, (p: Obj) => boolean> = {
	intent: validIntent,
	receipt: validReceipt,
	lookup: (p) => isTime(p.ts) && matches(p.ref, REF),
	catalog: (p) => isTime(p.ts),
};

/**
 * Step 6: `v`, `typ` and the type's fields. For intents, an over-long lifetime is reported as
 * `TOKEN_LIFETIME_EXCEEDED` only after every other schema check passes.
 */
export function validateEsignPayload<T extends EsignTokenType>(
	type: T,
	payload: unknown,
): Result<EsignPayloads[T], SchemaError> {
	if (
		!isObject(payload) ||
		payload.v !== 1 ||
		payload.typ !== type ||
		!matches(payload.cid, CLIENT_ID_PATTERN) ||
		!TYPE_FIELDS[type](payload)
	) {
		return err("PAYLOAD_INVALID");
	}
	if (type === "intent" && (payload.exp as number) - (payload.iat as number) > ESIGN_INTENT_MAX_LIFETIME_SECONDS) {
		return err("TOKEN_LIFETIME_EXCEEDED");
	}
	return ok(payload as unknown as EsignPayloads[T]);
}

// --- return URL allowlist (§7) ---

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(text: string): URL | undefined {
	try {
		return new URL(text);
	} catch {
		return undefined;
	}
}

function hasUserinfo(url: URL): boolean {
	return url.username !== "" || url.password !== "";
}

/** An allowlist entry: https (or http on a loopback host), no userinfo, query or fragment. */
function parseEntry(text: string): URL | undefined {
	const url = parseUrl(text);
	if (url === undefined || hasUserinfo(url) || url.search !== "" || text.includes("#")) return undefined;
	const allowedScheme = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
	return allowedScheme ? url : undefined;
}

function pathMatches(path: string, entryPath: string): boolean {
	if (entryPath.endsWith("/")) return path.startsWith(entryPath);
	return path === entryPath || path.startsWith(`${entryPath}/`);
}

/**
 * §7: an absolute http(s) URL with no userinfo and no fragment (not even an empty `#`), whose
 * scheme, host and port equal some entry's and whose path matches it by segment prefix, after
 * WHATWG URL normalisation of both. The query is not compared. Invalid entries never match.
 */
export function isReturnUrlAllowed(returnUrl: string, allowlist: readonly string[]): boolean {
	const url = parseUrl(returnUrl);
	if (url === undefined || (url.protocol !== "https:" && url.protocol !== "http:")) return false;
	if (hasUserinfo(url) || returnUrl.includes("#")) return false;
	return allowlist.some((text) => {
		const entry = parseEntry(text);
		return entry !== undefined && entry.origin === url.origin && pathMatches(url.pathname, entry.pathname);
	});
}

// --- verification (§6) ---

export interface EsignClient {
	/** The raw 32-byte HMAC key. */
	readonly secret: Uint8Array;
	readonly revoked: boolean;
	/** Intents only. Absent or empty: same-origin with the e-sign site (`siteOrigin + "/"`). */
	readonly returnUrlAllowlist?: readonly string[] | undefined;
}

/** Looks a client up by `cid`. Return `undefined` when it is not registered. */
export type EsignClientLookup = (cid: string) => EsignClient | undefined | Promise<EsignClient | undefined>;

/**
 * Atomically records `(cid, nonce)` (put-if-absent, retained until at least `expiresAt`, epoch
 * seconds). Returns `true` when newly recorded and `false` when it was already consumed, including a
 * lost race.
 */
export type ConsumeNonce = (cid: string, nonce: string, expiresAt: number) => boolean | Promise<boolean>;

export interface VerifyEsignTokenInput {
	/** The token as received; anything but a string is `TOKEN_MALFORMED`. */
	readonly token: unknown;
	/** Current time in epoch milliseconds (injected); truncated to whole seconds. */
	readonly now: number;
	readonly getClient: EsignClientLookup;
}

export interface VerifyIntentTokenInput extends VerifyEsignTokenInput {
	readonly consumeNonce: ConsumeNonce;
	/** The e-sign site's origin, e.g. `https://esign.example`, for clients with no allowlist. Absent: such clients allow nothing. */
	readonly siteOrigin?: string | undefined;
}

export type EsignVerifyResult<T extends EsignTokenType> = Result<EsignPayloads[T], EsignTokenError>;

/** Steps 1–5: size, structure, payload decoding, client and signature. */
async function authenticate(
	type: EsignTokenType,
	input: VerifyEsignTokenInput,
): Promise<Result<{ payload: Obj; client: EsignClient }, EsignTokenError>> {
	const { token } = input;
	if (typeof token !== "string") return err("TOKEN_MALFORMED");
	// 1. Size, before any decoding.
	if (token.length > ESIGN_MAX_TOKEN_LENGTH[type]) return err("TOKEN_TOO_LARGE");
	// 2. Structure.
	const segments = token.split(".");
	if (segments.length !== 2) return err("TOKEN_MALFORMED");
	const [payloadB64, sig] = segments as [string, string];
	const payloadBytes = decodeBase64Url(payloadB64);
	if (payloadBytes === undefined || payloadBytes.length === 0) return err("TOKEN_MALFORMED");
	if (sig.length !== 43 || decodeBase64Url(sig) === undefined) return err("TOKEN_MALFORMED");
	// 3. Payload decoding: strict UTF-8, no BOM, a JSON object with a grammatical cid.
	const payload = decodeJsonObject(payloadBytes);
	if (payload === undefined || !matches(payload.cid, CLIENT_ID_PATTERN)) return err("TOKEN_MALFORMED");
	// 4. Client. Nothing in the payload is trusted yet; cid only selects the key.
	const client = await input.getClient(payload.cid);
	if (client === undefined) return err("CLIENT_UNKNOWN");
	if (client.revoked) return err("CLIENT_REVOKED");
	// 5. Signature over the received segment, compared without an early exit.
	const expected = await signature(client.secret, ESIGN_PREFIXES[type], payloadB64);
	if (!constantTimeEqual(expected, sig)) return err("TOKEN_INVALID");
	return ok({ payload, client });
}

function decodeJsonObject(bytes: Uint8Array): Obj | undefined {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return undefined;
	try {
		const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		return isObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function issuedAt(type: EsignTokenType, payload: EsignPayloads[EsignTokenType]): number {
	if (type === "intent") return (payload as IntentPayload).iat;
	if (type === "receipt") return (payload as ReceiptPayload).at;
	return (payload as LookupPayload | CatalogPayload).ts;
}

/** Last moment (epoch s) a token is valid, skew included; `undefined` for receipts, which never expire. */
function validUntil(type: EsignTokenType, payload: EsignPayloads[EsignTokenType]): number | undefined {
	if (type === "intent") return (payload as IntentPayload).exp + ESIGN_CLOCK_SKEW_SECONDS;
	if (type === "receipt") return undefined;
	return (payload as LookupPayload).ts + ESIGN_REQUEST_MAX_AGE_SECONDS + ESIGN_CLOCK_SKEW_SECONDS;
}

/** Steps 1–7, shared by every type. */
async function verifyCommon<T extends EsignTokenType>(
	type: T,
	input: VerifyEsignTokenInput,
): Promise<Result<{ payload: EsignPayloads[T]; client: EsignClient }, EsignTokenError>> {
	const auth = await authenticate(type, input);
	if (!auth.ok) return auth;
	// 6. Schema.
	const schema = validateEsignPayload(type, auth.value.payload);
	if (!schema.ok) return schema;
	// 7. Time, inclusive boundaries.
	const now = Math.floor(input.now / 1000);
	if (issuedAt(type, schema.value) > now + ESIGN_CLOCK_SKEW_SECONDS) return err("TOKEN_NOT_YET_VALID");
	const until = validUntil(type, schema.value);
	if (until !== undefined && now > until) return err("TOKEN_EXPIRED");
	return ok({ payload: schema.value, client: auth.value.client });
}

/**
 * Verifies an `esign-intent/1` token (e-sign, `public/envelopes/from-intent`). Runs §6.2 steps 1–9;
 * the nonce is consumed only after every earlier step passed, so a rejected intent never burns it.
 */
export async function verifyIntentToken(input: VerifyIntentTokenInput): Promise<EsignVerifyResult<"intent">> {
	const common = await verifyCommon("intent", input);
	if (!common.ok) return common;
	const { payload, client } = common.value;
	// 8. Return URL.
	const allowlist = client.returnUrlAllowlist?.length
		? client.returnUrlAllowlist
		: input.siteOrigin === undefined
			? []
			: [`${input.siteOrigin}/`];
	if (!isReturnUrlAllowed(payload.returnUrl, allowlist)) return err("RETURN_URL_NOT_ALLOWED");
	// 9. Nonce, put-if-absent.
	const recorded = await input.consumeNonce(payload.cid, payload.nonce, payload.exp + ESIGN_CLOCK_SKEW_SECONDS);
	if (!recorded) return err("TOKEN_REPLAYED");
	return ok(payload);
}

async function verifySimple<T extends Exclude<EsignTokenType, "intent">>(
	type: T,
	input: VerifyEsignTokenInput,
): Promise<EsignVerifyResult<T>> {
	const common = await verifyCommon(type, input);
	return common.ok ? ok(common.value.payload) : common;
}

/** Verifies an `esign-receipt/1` token (Events, `signatures/receipt`). Receipts never expire. */
export function verifyReceiptToken(input: VerifyEsignTokenInput): Promise<EsignVerifyResult<"receipt">> {
	return verifySimple("receipt", input);
}

/** Verifies an `esign-lookup/1` request (e-sign, `public/receipts/lookup`). */
export function verifyLookupToken(input: VerifyEsignTokenInput): Promise<EsignVerifyResult<"lookup">> {
	return verifySimple("lookup", input);
}

/** Verifies an `esign-catalog/1` request (e-sign, `public/templates/catalog`). */
export function verifyCatalogToken(input: VerifyEsignTokenInput): Promise<EsignVerifyResult<"catalog">> {
	return verifySimple("catalog", input);
}

// --- issuing (§4) ---

/**
 * Mints a token: `JSON.stringify(payload)` (field order as given), base64url, and the HMAC under the
 * type's prefix. Throws if the payload breaks its schema or the token would exceed the type's max
 * length, so an issuer cannot emit a token its peer must reject. Time rules are the caller's
 * (e.g. Events caps `exp` at the booking hold).
 */
export async function signEsignToken<T extends EsignTokenType>(
	type: T,
	payload: EsignPayloads[T],
	secret: Uint8Array,
): Promise<string> {
	const schema = validateEsignPayload(type, payload);
	if (!schema.ok) throw new Error(`Cannot sign ${type} token: ${schema.error}.`);
	const payloadB64 = encodeBase64Url(utf8.encode(JSON.stringify(payload)));
	const token = `${payloadB64}.${await signature(secret, ESIGN_PREFIXES[type], payloadB64)}`;
	if (token.length > ESIGN_MAX_TOKEN_LENGTH[type]) throw new Error(`Cannot sign ${type} token: TOKEN_TOO_LARGE.`);
	return token;
}
