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

interface ErrorDef {
	readonly status: number;
	/** User-safe default message: never contains internals, identifiers or secrets. */
	readonly message: string;
}

function def(status: number, message: string): ErrorDef {
	return Object.freeze({ status, message });
}

/**
 * Every stable error code, with its HTTP status and user-safe message.
 *
 * Naming: a name that could mean two things is prefixed by area (`BOOKING_TOKEN_*` for the
 * Events booking token vs the protocol's `TOKEN_*` for esign-intent tokens; `SIGNING_TOKEN_*`
 * for the e-sign signer link).
 */
export const ERROR_CODES = Object.freeze({
	// --- common ---
	BAD_REQUEST: def(400, "The request was not valid."),
	NOT_FOUND: def(404, "Not found."),
	RATE_LIMITED: def(429, "Too many requests. Please try again shortly."),
	TURNSTILE_FAILED: def(403, "The bot check failed. Please try again."),
	TOKEN_IN_QUERY: def(400, "Tokens must not be sent in the URL."),
	INTERNAL: def(500, "Something went wrong. Please try again later."),

	// --- events ---
	SOLD_OUT: def(409, "This event is sold out."),
	HOLD_EXPIRED: def(409, "Your hold has expired. Please start again."),
	SALES_CLOSED: def(409, "Sales for this event are closed."),
	BOOKING_TOKEN_INVALID: def(404, "Not found."),
	BOOKING_TOKEN_EXPIRED: def(401, "This booking link has expired."),

	// --- e-sign ---
	ENVELOPE_NOT_FOUND: def(404, "Document not found."),
	ENVELOPE_CLOSED: def(409, "This document can no longer be signed."),
	SIGNING_TOKEN_INVALID: def(401, "This signing link is not valid."),
	SIGNING_TOKEN_EXPIRED: def(401, "This signing link has expired."),
	SIGNED_PDF_PENDING: def(409, "The signed document is still being prepared. Please try again in a minute."),

	// --- protocol (docs/protocol/esign-intent-v1.md §9; strings and statuses are verbatim) ---
	TOKEN_TOO_LARGE: def(413, "The token is too large."),
	TOKEN_MALFORMED: def(400, "The token is malformed."),
	CLIENT_UNKNOWN: def(401, "The client is not recognised."),
	CLIENT_REVOKED: def(403, "The client has been revoked."),
	TOKEN_INVALID: def(401, "The token is not valid."),
	PAYLOAD_INVALID: def(400, "The token payload is not valid."),
	TOKEN_LIFETIME_EXCEEDED: def(400, "The token lifetime is too long."),
	TOKEN_NOT_YET_VALID: def(401, "The token is not valid yet."),
	TOKEN_EXPIRED: def(401, "The token has expired."),
	RETURN_URL_NOT_ALLOWED: def(400, "The return URL is not allowed."),
	TOKEN_REPLAYED: def(409, "The token has already been used."),
	PAIRING_MALFORMED: def(400, "The pairing string is malformed."),
	TEMPLATE_NOT_FOUND: def(404, "Template not found."),
	REF_UNKNOWN: def(404, "Reference not found."),

	// --- payments ---
	PAYMENT_FAILED: def(402, "The payment could not be completed."),

	// --- licence ---
	LICENCE_INVALID: def(403, "The licence is not valid."),
	LICENCE_EXPIRED: def(403, "The licence has expired."),
} as const satisfies Record<string, ErrorDef>);

export type ErrorCode = keyof typeof ERROR_CODES;

/** The JSON error body shared by every route (matches the protocol spec). */
export interface RouteErrorBody {
	readonly ok: false;
	readonly error: { readonly code: ErrorCode; readonly message: string };
}

export interface RouteError {
	readonly status: number;
	readonly body: RouteErrorBody;
}

function isErrorCode(value: unknown): value is ErrorCode {
	return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
}

function extractCode(error: unknown): unknown {
	if (typeof error === "string") return error;
	if (typeof error === "object" && error !== null && "code" in error) return error.code;
	return undefined;
}

/**
 * Map a code, a `{ code }` object or an Error carrying a `code` to its route response. Anything
 * unknown becomes 500 `INTERNAL` with the generic message: the original message and stack are
 * never included.
 */
export function toRouteError(error: unknown): RouteError {
	const raw = extractCode(error);
	const code: ErrorCode = isErrorCode(raw) ? raw : "INTERNAL";
	const { status, message } = ERROR_CODES[code];
	return { status, body: { ok: false, error: { code, message } } };
}
