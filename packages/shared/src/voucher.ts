/**
 * voucher/1 tokens and pairing strings (docs/protocol/voucher-v1.md): Vouchers signs holds and lookup
 * requests, Events signs settle tokens, and the suite carries them between the two plugins.
 *
 * Reuses the esign-intent/1 primitives from `hmac.ts` (base64url, HMAC-SHA256 under a per-type prefix,
 * strict JSON decoding) and runs the same verification steps 1–7 in the same order; only prefixes,
 * payloads and parameters differ. Web Crypto only; time and clients are injected. Nothing here logs, and
 * no error carries token or secret material.
 */
import {
	CLIENT_ID_PATTERN,
	decodeBase64Url,
	decodeJsonObject,
	ESIGN_CLOCK_SKEW_SECONDS,
	ESIGN_SECRET_BYTES,
	type EsignTokenError,
	encodeBase64Url,
	ID64_PATTERN,
	isJsonObject,
	isUnixTime,
	matchesPattern,
	REF_PATTERN,
	type SchemaError,
	tokenSignature,
} from "./hmac";
import type { Pairing } from "./pairing";
import { err, ok, type Result } from "./result";
import { constantTimeEqual } from "./tokens";

export type VoucherTokenType = "hold" | "settle" | "lookup";

/** HMAC prefix per token type (§4). A verifier picks it from the route, never the payload. */
export const VOUCHER_PREFIXES = Object.freeze({
	hold: "voucher-hold/1",
	settle: "voucher-settle/1",
	lookup: "voucher-lookup/1",
} as const satisfies Record<VoucherTokenType, string>);

/** Max token length in characters per type (§4). */
export const VOUCHER_MAX_TOKEN_LENGTH = Object.freeze({
	hold: 1024,
	settle: 1024,
	lookup: 1024,
} as const satisfies Record<VoucherTokenType, number>);

/** Clock-skew allowance `S` (§6.1), the same as esign-intent/1's. */
export const VOUCHER_CLOCK_SKEW_SECONDS = ESIGN_CLOCK_SKEW_SECONDS;
/** Longest hold lifetime, `exp − iat` (§6.1). */
export const VOUCHER_HOLD_MAX_LIFETIME_SECONDS = 1800;
/** Lookup request max age `A` (§6.1). */
export const VOUCHER_REQUEST_MAX_AGE_SECONDS = 300;
/** Largest amount in minor units (§5): 100,000.00. */
export const VOUCHER_MAX_MINOR = 10_000_000;

/** Every code voucher/1 token verification can return (§9, minus the settings-only `PAIRING_MALFORMED`). */
export type VoucherTokenError = Exclude<EsignTokenError, "RETURN_URL_NOT_ALLOWED" | "TOKEN_REPLAYED">;

// --- payloads (§5). Unknown fields are ignored on verify and preserved in the returned payload. ---

interface PayloadBase<T extends VoucherTokenType> {
	readonly v: 1;
	readonly typ: T;
	readonly cid: string;
}

export type VoucherKind = "money" | "activity";

export interface HoldPayload extends PayloadBase<"hold"> {
	readonly rid: string;
	readonly iat: number;
	readonly exp: number;
	readonly ref: string;
	readonly kind: VoucherKind;
	/** Money: the amount held (≥ 1). Activity: the ticket's unit price as Vouchers was told it (≥ 0). */
	readonly amountMinor: number;
	readonly currency: string;
	/** Present iff `kind === "activity"`. */
	readonly line?: { readonly eventId: string; readonly ticketTypeId: string };
}

export type SettleOutcome = "confirmed" | "released" | "credited";

export interface SettlePayload extends PayloadBase<"settle"> {
	readonly rid: string;
	readonly ref: string;
	readonly outcome: SettleOutcome;
	/** Total credited back for `rid` so far: ≥ 1 when credited, 0 otherwise. */
	readonly creditMinor: number;
	readonly at: number;
}

export interface VoucherLookupPayload extends PayloadBase<"lookup"> {
	readonly ts: number;
	readonly ref: string;
	readonly rid: string;
}

export interface VoucherPayloads {
	hold: HoldPayload;
	settle: SettlePayload;
	lookup: VoucherLookupPayload;
}

// --- schemas (§5) ---

type Obj = Record<string, unknown>;

const CURRENCY = /^[A-Z]{3}$/;
const OUTCOMES: ReadonlySet<unknown> = new Set(["confirmed", "released", "credited"]);

/** A `minor` amount: a safe integer `min ≤ n ≤ VOUCHER_MAX_MINOR`. */
function isMinor(value: unknown, min: number): boolean {
	return isUnixTime(value) && value >= min && value <= VOUCHER_MAX_MINOR;
}

function validHold(p: Obj): boolean {
	const activity = p.kind === "activity";
	const line = p.line;
	return (
		matchesPattern(p.rid, ID64_PATTERN) &&
		isUnixTime(p.iat) &&
		isUnixTime(p.exp) &&
		p.exp > p.iat &&
		matchesPattern(p.ref, REF_PATTERN) &&
		(activity || p.kind === "money") &&
		isMinor(p.amountMinor, activity ? 0 : 1) &&
		matchesPattern(p.currency, CURRENCY) &&
		(activity
			? isJsonObject(line) &&
				matchesPattern(line.eventId, ID64_PATTERN) &&
				matchesPattern(line.ticketTypeId, ID64_PATTERN)
			: !Object.hasOwn(p, "line"))
	);
}

function validSettle(p: Obj): boolean {
	const credited = p.outcome === "credited";
	return (
		matchesPattern(p.rid, ID64_PATTERN) &&
		matchesPattern(p.ref, REF_PATTERN) &&
		OUTCOMES.has(p.outcome) &&
		(credited ? isMinor(p.creditMinor, 1) : p.creditMinor === 0) &&
		isUnixTime(p.at)
	);
}

const TYPE_FIELDS: Record<VoucherTokenType, (p: Obj) => boolean> = {
	hold: validHold,
	settle: validSettle,
	lookup: (p) => isUnixTime(p.ts) && matchesPattern(p.ref, REF_PATTERN) && matchesPattern(p.rid, ID64_PATTERN),
};

/**
 * Step 6: `v`, `typ` and the type's fields. For holds, an over-long lifetime is reported as
 * `TOKEN_LIFETIME_EXCEEDED` only after every other schema check passes.
 */
export function validateVoucherPayload<T extends VoucherTokenType>(
	type: T,
	payload: unknown,
): Result<VoucherPayloads[T], SchemaError> {
	if (
		!isJsonObject(payload) ||
		payload.v !== 1 ||
		payload.typ !== type ||
		!matchesPattern(payload.cid, CLIENT_ID_PATTERN) ||
		!TYPE_FIELDS[type](payload)
	) {
		return err("PAYLOAD_INVALID");
	}
	if (type === "hold" && (payload.exp as number) - (payload.iat as number) > VOUCHER_HOLD_MAX_LIFETIME_SECONDS) {
		return err("TOKEN_LIFETIME_EXCEEDED");
	}
	return ok(payload as unknown as VoucherPayloads[T]);
}

// --- verification (§6) ---

export interface VoucherClient {
	/** The raw 32-byte HMAC key. */
	readonly secret: Uint8Array;
	readonly revoked: boolean;
}

/** Looks a client up by `cid`; `undefined` when it is not paired. Events' table has one entry. */
export type VoucherClientLookup = (cid: string) => VoucherClient | undefined | Promise<VoucherClient | undefined>;

export interface VerifyVoucherTokenInput {
	/** The token as received; anything but a string is `TOKEN_MALFORMED`. */
	readonly token: unknown;
	/** Current time in epoch milliseconds (injected); truncated to whole seconds. */
	readonly now: number;
	readonly getClient: VoucherClientLookup;
}

export type VoucherVerifyResult<T extends VoucherTokenType> = Result<VoucherPayloads[T], VoucherTokenError>;

/** Steps 1–5: size, structure, payload decoding, client and signature. */
async function authenticate(
	type: VoucherTokenType,
	input: VerifyVoucherTokenInput,
): Promise<Result<Obj, VoucherTokenError>> {
	const { token } = input;
	if (typeof token !== "string") return err("TOKEN_MALFORMED");
	if (token.length > VOUCHER_MAX_TOKEN_LENGTH[type]) return err("TOKEN_TOO_LARGE");
	const segments = token.split(".");
	if (segments.length !== 2) return err("TOKEN_MALFORMED");
	const [payloadB64, sig] = segments as [string, string];
	const payloadBytes = decodeBase64Url(payloadB64);
	if (payloadBytes === undefined || payloadBytes.length === 0) return err("TOKEN_MALFORMED");
	if (sig.length !== 43 || decodeBase64Url(sig) === undefined) return err("TOKEN_MALFORMED");
	const payload = decodeJsonObject(payloadBytes);
	if (payload === undefined || !matchesPattern(payload.cid, CLIENT_ID_PATTERN)) return err("TOKEN_MALFORMED");
	const client = await input.getClient(payload.cid);
	if (client === undefined) return err("CLIENT_UNKNOWN");
	if (client.revoked) return err("CLIENT_REVOKED");
	const expected = await tokenSignature(client.secret, VOUCHER_PREFIXES[type], payloadB64);
	if (!constantTimeEqual(expected, sig)) return err("TOKEN_INVALID");
	return ok(payload);
}

/** Issue time and last valid moment (skew included; `undefined` for settle tokens, which never expire). */
function timeWindow(type: VoucherTokenType, p: Obj): [issued: number, until: number | undefined] {
	if (type === "hold") return [p.iat as number, (p.exp as number) + VOUCHER_CLOCK_SKEW_SECONDS];
	if (type === "settle") return [p.at as number, undefined];
	return [p.ts as number, (p.ts as number) + VOUCHER_REQUEST_MAX_AGE_SECONDS + VOUCHER_CLOCK_SKEW_SECONDS];
}

/**
 * Verifies a voucher/1 token of the expected `type` (§6.2 steps 1–7). The first failure is the result, so
 * every implementation reports the same code. Events verifies `hold` and `lookup`; Vouchers verifies `settle`.
 */
export async function verifyVoucherToken<T extends VoucherTokenType>(
	type: T,
	input: VerifyVoucherTokenInput,
): Promise<VoucherVerifyResult<T>> {
	const auth = await authenticate(type, input);
	if (!auth.ok) return auth;
	const schema = validateVoucherPayload(type, auth.value);
	if (!schema.ok) return schema;
	const now = Math.floor(input.now / 1000);
	const [issued, until] = timeWindow(type, auth.value);
	if (issued > now + VOUCHER_CLOCK_SKEW_SECONDS) return err("TOKEN_NOT_YET_VALID");
	if (until !== undefined && now > until) return err("TOKEN_EXPIRED");
	return schema;
}

// --- issuing (§4) ---

const utf8 = new TextEncoder();

/**
 * Mints a token: `JSON.stringify(payload)` (field order as given), base64url, and the HMAC under the type's
 * prefix. Throws if the payload breaks its schema, the secret is not 32 bytes, or the token would exceed
 * the type's max length, so an issuer cannot emit a token its peer must reject.
 */
export async function signVoucherToken<T extends VoucherTokenType>(
	type: T,
	payload: VoucherPayloads[T],
	secret: Uint8Array,
): Promise<string> {
	const schema = validateVoucherPayload(type, payload);
	if (!schema.ok) throw new Error(`Cannot sign ${type} token: ${schema.error}.`);
	const payloadB64 = encodeBase64Url(utf8.encode(JSON.stringify(payload)));
	const token = `${payloadB64}.${await tokenSignature(secret, VOUCHER_PREFIXES[type], payloadB64)}`;
	if (token.length > VOUCHER_MAX_TOKEN_LENGTH[type]) throw new Error(`Cannot sign ${type} token: TOKEN_TOO_LARGE.`);
	return token;
}

// --- pairing (§3) ---

const PAIRING = /^voucher1\.([A-Za-z0-9_-]{4,64})\.([A-Za-z0-9_-]{43})$/;

/** Parses a `voucher1.<clientId>.<secret>` pairing string exactly as given: no trimming. */
export function parseVoucherPairing(value: string): Result<Pairing, "PAIRING_MALFORMED"> {
	const match = typeof value === "string" ? PAIRING.exec(value) : null;
	const secret = match ? decodeBase64Url(match[2] as string) : undefined;
	if (!match || secret?.length !== ESIGN_SECRET_BYTES) return err("PAIRING_MALFORMED");
	return ok({ clientId: match[1] as string, secret });
}

/** Builds the pairing string Vouchers' admin shows once when a client is created. */
export function formatVoucherPairing(clientId: string, secret: Uint8Array): string {
	if (!CLIENT_ID_PATTERN.test(clientId)) throw new Error("Client id must match the voucher/1 clientId grammar.");
	if (secret.length !== ESIGN_SECRET_BYTES) throw new Error(`Client secret must be ${ESIGN_SECRET_BYTES} bytes.`);
	return `voucher1.${clientId}.${encodeBase64Url(secret)}`;
}
