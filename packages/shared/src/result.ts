/**
 * Result type, stable error-code registry and route error mapping.
 *
 * Codes are API: once published a code never changes meaning or status. Pure, Web APIs only.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = ErrorCode> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
	return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
	return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
	return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
	return !result.ok;
}

export interface ErrorDef {
	readonly status: number;
	/** User-safe default message: never contains internals, identifiers or secrets. */
	readonly message: string;
}

type Group = Record<string, readonly [status: number, message: string]>;

/**
 * A frozen code table from `[status, message]` groups. The groups are plain data passed as separate
 * arguments (no spread), so a bundler drops the groups a core never builds a table from.
 */
function table<
	A extends Group,
	B extends Group,
	C extends Group,
	D extends Group = Record<never, never>,
	E extends Group = Record<never, never>,
>(...groups: [A, B, C, D?, E?]): { readonly [K in keyof (A & B & C & D & E)]: ErrorDef } {
	const out: Record<string, ErrorDef> = {};
	for (const group of groups)
		for (const [code, [status, message]] of Object.entries(group ?? {})) out[code] = Object.freeze({ status, message });
	return Object.freeze(out) as never;
}

// The registry is built from groups so a core bundles only the groups it answers with (R96).
const COMMON_ERRORS = {
	// --- common ---
	BAD_REQUEST: [400, "The request was not valid."],
	NOT_FOUND: [404, "Not found."],
	RATE_LIMITED: [429, "Too many requests. Please try again shortly."],
	TURNSTILE_FAILED: [403, "The bot check failed. Please try again."],
	TOKEN_IN_QUERY: [400, "Tokens must not be sent in the URL."],
	INTERNAL: [500, "Something went wrong. Please try again later."],

	// --- events ---
	SOLD_OUT: [409, "This event is sold out."],
	HOLD_EXPIRED: [409, "Your hold has expired. Please start again."],
	SALES_CLOSED: [409, "Sales for this event are closed."],
	BOOKING_TOKEN_INVALID: [404, "Not found."],
	BOOKING_TOKEN_EXPIRED: [401, "This booking link has expired."],
	CANCEL_NOT_ALLOWED: [409, "This booking can no longer be cancelled online."],
} as const;

const ESIGN_ERRORS = {
	// --- e-sign ---
	ENVELOPE_NOT_FOUND: [404, "Document not found."],
	ENVELOPE_CLOSED: [409, "This document can no longer be signed."],
	SIGNING_TOKEN_INVALID: [401, "This signing link is not valid."],
	SIGNING_TOKEN_EXPIRED: [401, "This signing link has expired."],
	SESSION_REQUIRED: [409, "Please reopen the signing page and try again."],
	SIGNED_PDF_PENDING: [409, "The signed document is still being prepared. Please try again in a minute."],
	/** E-sign Pro sequential routing (T090): an earlier signer has not signed yet. */
	SIGNING_OUT_OF_TURN: [409, "Another signer has to sign first. You will get an email when it is your turn."],

	/** E-sign Pro (T091): the envelope needs a verified email one-time code first; the code routes are Pro's. */
	OTP_REQUIRED: [403, "Enter the code we emailed you before signing."],
} as const;

const TOKEN_INVALID = [401, "The token is not valid."] as const;
const TOKEN_EXPIRED = [401, "The token has expired."] as const;
const REF_UNKNOWN = [404, "Reference not found."] as const;

const PROTOCOL_ERRORS = {
	// --- protocol (docs/protocol/esign-intent-v1.md §9; strings and statuses are verbatim) ---
	TOKEN_TOO_LARGE: [413, "The token is too large."],
	TOKEN_MALFORMED: [400, "The token is malformed."],
	CLIENT_UNKNOWN: [401, "The client is not recognised."],
	CLIENT_REVOKED: [403, "The client has been revoked."],
	TOKEN_INVALID,
	PAYLOAD_INVALID: [400, "The token payload is not valid."],
	TOKEN_LIFETIME_EXCEEDED: [400, "The token lifetime is too long."],
	TOKEN_NOT_YET_VALID: [401, "The token is not valid yet."],
	TOKEN_EXPIRED,
	RETURN_URL_NOT_ALLOWED: [400, "The return URL is not allowed."],
	TOKEN_REPLAYED: [409, "The token has already been used."],
	PAIRING_MALFORMED: [400, "The pairing string is malformed."],
	TEMPLATE_NOT_FOUND: [404, "Template not found."],
	REF_UNKNOWN,
} as const;

const PAYMENT_ERRORS = {
	// --- payments ---
	PAYMENT_FAILED: [402, "The payment could not be completed."],
} as const;

const LICENCE_ERRORS = {
	// --- licence ---
	LICENCE_INVALID: [403, "The licence is not valid."],
	LICENCE_EXPIRED: [403, "The licence has expired."],
} as const;

/**
 * Every stable error code, with its HTTP status and user-safe message.
 *
 * Naming: a name that could mean two things is prefixed by area (`BOOKING_TOKEN_*` for the
 * Events booking token vs the protocol's `TOKEN_*` for esign-intent tokens; `SIGNING_TOKEN_*`
 * for the e-sign signer link).
 */
export const ERROR_CODES = /* @__PURE__ */ table(
	COMMON_ERRORS,
	ESIGN_ERRORS,
	PROTOCOL_ERRORS,
	PAYMENT_ERRORS,
	LICENCE_ERRORS,
);

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * The codes an Events core answers with itself (R96): common, events, payments and licence (Pro steps
 * refuse through Free routes), plus the protocol's `TOKEN_INVALID`/`TOKEN_EXPIRED` (calendar links)
 * and `REF_UNKNOWN` (receipts). The e-sign and other protocol messages stay out of its bundle; an edition that answers them too passes
 * `ERROR_CODES` to the core's `useErrorCodes`.
 */
export const EVENTS_ERROR_CODES: Readonly<Partial<Record<keyof typeof ERROR_CODES, ErrorDef>>> = /* @__PURE__ */ table(
	COMMON_ERRORS,
	PAYMENT_ERRORS,
	LICENCE_ERRORS,
	{ TOKEN_INVALID, TOKEN_EXPIRED, REF_UNKNOWN },
);

/** The JSON error body shared by every route (matches the protocol spec). */
export interface RouteErrorBody {
	readonly ok: false;
	readonly error: { readonly code: ErrorCode; readonly message: string };
}

export interface RouteError {
	readonly status: number;
	readonly body: RouteErrorBody;
}

function extractCode(error: unknown): unknown {
	if (typeof error === "string") return error;
	if (typeof error === "object" && error !== null && "code" in error) return error.code;
	return undefined;
}

/** A code table: every code (`ERROR_CODES`) or a core's subset (`EVENTS_ERROR_CODES`). */
export type ErrorTable = Readonly<Partial<Record<ErrorCode, ErrorDef>>>;

/**
 * `toRouteError` over `table`: a code the table lacks is `INTERNAL` (which every table has). A core
 * that bundles a subset calls this instead of `toRouteError`, so the full registry stays out (R96).
 */
export function routeErrorFrom(table: ErrorTable, error: unknown): RouteError {
	const raw = extractCode(error);
	const code = (typeof raw === "string" && Object.hasOwn(table, raw) ? raw : "INTERNAL") as ErrorCode;
	const { status, message } = table[code] as ErrorDef;
	return { status, body: { ok: false, error: { code, message } } };
}

/**
 * Map a code, a `{ code }` object or an Error carrying a `code` to its route response. Anything
 * unknown becomes 500 `INTERNAL` with the generic message: the original message and stack are
 * never included.
 */
export function toRouteError(error: unknown): RouteError {
	return routeErrorFrom(ERROR_CODES, error);
}
