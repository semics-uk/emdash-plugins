/**
 * Checkout reservation (EV-FR-05, R9, R22): input validation, idempotency keys, and the plan of a
 * `public/checkout/reserve` order. Pure apart from hashing; time is passed in.
 *
 * The order is planned from the event config alone: `config/save` keeps a catalog of the event's
 * ticket types and occurrences on it (`EventCatalog`), so the route reads one document instead of
 * three. The catalog carries capacities but no counters, so only the event-level counter can answer
 * `SOLD_OUT` before a write; the reservation guards (which pin the planned capacity) decide the rest.
 */
import { err, ok, type Result } from "@semics-tech/shared";

import type { BookingDoc, BookingLine, EventConfigDoc } from "../storage/schema";
import { type Counter, planReservation, type ReserveStep } from "./inventory";

/** Most lines and seats per line one order may carry. */
export const MAX_LINES = 10;
export const MAX_QTY_PER_LINE = 50;

/** Bookings one client IP may create per sliding window (EV-FR-05: spam bookings, inventory abuse). */
export const RESERVE_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 } as const;

export interface InputIssue {
	path: string;
	code: string;
}

// The body validators. These replaced zod/mini schemas (T047, T048) to keep the sandbox bundle small
// (R42, T118): same rules, same issue paths and codes in the same order, and the same normalised
// value. `tests/domain/checkout-input.test.ts` checks them against the original schemas.
type Path = ReadonlyArray<string | number>;
type Validator<T> = (value: unknown, path: Path, issues: InputIssue[]) => T;

function report(issues: InputIssue[], path: Path, code: string): void {
	issues.push({ path: path.length > 0 ? path.join(".") : "input", code });
}

// zod 4's email pattern (`z.email()`), verbatim.
const EMAIL = /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

interface TextRule {
	min?: number;
	max?: number;
	pattern?: RegExp;
	trim?: boolean;
	lower?: boolean;
	/** Also an email address, checked only when every other check passed. */
	email?: boolean;
}

/**
 * Length bounds. Like zod's, they also run after a type error, on any value with a `length` (so
 * `""` given for a list is both `invalid_type` and `too_small`).
 */
function checkLength(
	value: unknown,
	min: number | undefined,
	max: number | undefined,
	path: Path,
	issues: InputIssue[],
) {
	const length = (value as { length?: number } | null | undefined)?.length;
	if (length === undefined) return;
	if (min !== undefined && !(length >= min)) report(issues, path, "too_small");
	if (max !== undefined && !(length <= max)) report(issues, path, "too_big");
}

/** A string: trimmed and lowercased first when asked, then checked for length and pattern. */
function text(rule: TextRule): Validator<string> {
	return (value, path, issues) => {
		if (typeof value !== "string") {
			report(issues, path, "invalid_type");
			checkLength(value, rule.min, rule.max, path, issues);
			return value as string;
		}
		const before = issues.length;
		let s = rule.trim ? value.trim() : value;
		if (rule.lower) s = s.toLowerCase();
		checkLength(s, rule.min, rule.max, path, issues);
		if (rule.pattern && !rule.pattern.test(s)) report(issues, path, "invalid_format");
		if (rule.email && issues.length === before && !EMAIL.test(s)) report(issues, path, "invalid_format");
		return s;
	};
}

/** A safe integer from `min` to `max`. */
function int(min: number, max: number): Validator<number> {
	return (value, path, issues) => {
		if (typeof value !== "number" || !Number.isInteger(value)) {
			report(issues, path, "invalid_type");
		} else {
			if (value > Number.MAX_SAFE_INTEGER) report(issues, path, "too_big");
			if (value < Number.MIN_SAFE_INTEGER) report(issues, path, "too_small");
			if (value < min) report(issues, path, "too_small");
			if (value > max) report(issues, path, "too_big");
		}
		return value as number;
	};
}

const bool: Validator<boolean> = (value, path, issues) => {
	if (typeof value !== "boolean") report(issues, path, "invalid_type");
	return value as boolean;
};

function optional<T>(inner: Validator<T>): Validator<T | undefined> {
	return (value, path, issues) => (value === undefined ? undefined : inner(value, path, issues));
}

/** An array of `min` to `max` items, each checked by `item`. */
function list<T>(item: Validator<T>, min: number, max: number): Validator<T[]> {
	return (value, path, issues) => {
		if (!Array.isArray(value)) {
			report(issues, path, "invalid_type");
			checkLength(value, min, max, path, issues);
			return value as T[];
		}
		const out = Array.from(value, (entry, i) => item(entry, [...path, i], issues));
		checkLength(out, min, max, path, issues);
		return out;
	};
}

/** An object with exactly the keys of `shape` (unknown keys are refused). */
function strict<T>(shape: { [K in keyof T]-?: Validator<T[K]> }): Validator<T> {
	return (value, path, issues) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			report(issues, path, "invalid_type");
			return value as T;
		}
		const input = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const key in shape) {
			const checked = (shape[key] as Validator<unknown>)(input[key], [...path, key], issues);
			if (checked !== undefined || key in input) out[key] = checked;
		}
		if (Object.keys(input).some((key) => !Object.hasOwn(shape, key))) report(issues, path, "unrecognized_keys");
		return out as T;
	};
}

function parser<T>(validator: Validator<T>): (raw: unknown) => Result<T, InputIssue[]> {
	return (raw) => {
		const issues: InputIssue[] = [];
		const value = validator(raw, [], issues);
		return issues.length > 0 ? err(issues) : ok(value);
	};
}

const docId = text({ min: 1, max: 200 });
const personName = text({ trim: true, min: 1, max: 200 });
const email = text({ trim: true, lower: true, max: 254, email: true });
const bookingRef = text({ pattern: /^[0-9A-HJKMNP-TV-Z]{10}$/ });
const accessToken = text({ pattern: /^[A-Za-z0-9_-]{43}$/ });

/**
 * The request body. `idempotencyKey` is a client-generated secret (at least 32 URL-safe characters,
 * new for each checkout attempt): it names the booking, so a resubmit finds it again. Unknown keys
 * are refused. The buyer's name is trimmed, the email trimmed and lowercased.
 */
export interface ReserveInput {
	eventId: string;
	occurrenceId?: string | undefined;
	lines: Array<{ ticketTypeId: string; qty: number }>;
	buyer: { name: string; email: string };
	idempotencyKey: string;
	turnstileToken?: string | undefined;
}

export const parseReserveInput = parser(
	strict<ReserveInput>({
		eventId: docId,
		occurrenceId: optional(docId),
		lines: list(strict({ ticketTypeId: docId, qty: int(1, MAX_QTY_PER_LINE) }), 1, MAX_LINES),
		buyer: strict({ name: personName, email }),
		idempotencyKey: text({ pattern: /^[A-Za-z0-9_-]{32,128}$/ }),
		turnstileToken: optional(text({ max: 2048 })),
	}),
);

/**
 * The `public/checkout/continue` body: the booking's public ref and the access token reserve
 * returned (in the body, never the URL), plus the attendee details. Without `attendees` every seat
 * is in the buyer's name.
 */
export interface ContinueInput {
	bookingRef: string;
	accessToken: string;
	attendees?:
		| Array<{
				ticketTypeId: string;
				name: string;
				email?: string | undefined;
				/** Under 18: the buyer signs any waiver for them as guardian (R5). */
				minor?: boolean | undefined;
		  }>
		| undefined;
}

export const parseContinueInput = parser(
	strict<ContinueInput>({
		bookingRef,
		accessToken,
		attendees: optional(
			list(
				strict({ ticketTypeId: docId, name: personName, email: optional(email), minor: optional(bool) }),
				1,
				MAX_LINES * MAX_QTY_PER_LINE,
			),
		),
	}),
);

/** The `public/booking` and `public/booking/cancel` body: the booking ref and access token only. */
export interface BookingAccessInput {
	bookingRef: string;
	accessToken: string;
}

export const parseBookingAccessInput = parser(strict<BookingAccessInput>({ bookingRef, accessToken }));

/** The `public/waitlist/join` body (T081): the email is trimmed and lowercased, at most 10 seats. */
export interface JoinInput {
	eventId: string;
	occurrenceId?: string | undefined;
	ticketTypeId?: string | undefined;
	name: string;
	email: string;
	qty: number;
	turnstileToken?: string | undefined;
}

export const parseJoinInput = parser(
	strict<JoinInput>({
		eventId: docId,
		occurrenceId: optional(docId),
		ticketTypeId: optional(docId),
		name: personName,
		email,
		qty: int(1, 10),
		turnstileToken: optional(text({ max: 2048 })),
	}),
);

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REF_LENGTH = 10;

/**
 * The booking id and public reference an idempotency key names: `bk_` + 128 bits of
 * SHA-256(domain ‖ key) in hex, and 50 further bits as Crockford base32. Neither reveals the key.
 */
export async function bookingKeys(idempotencyKey: string): Promise<{ id: string; ref: string }> {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`semics-events/booking/1:${idempotencyKey}`)),
	);
	const id = `bk_${Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("")}`;
	let ref = "";
	let acc = 0;
	let held = 0;
	let next = 16;
	while (ref.length < REF_LENGTH) {
		if (held < 5) {
			acc = (acc << 8) | (digest[next++] ?? 0);
			held += 8;
		}
		held -= 5;
		ref += CROCKFORD[(acc >> held) & 31];
		acc &= (1 << held) - 1;
	}
	return { id, ref };
}

export interface CheckoutPlan {
	steps: ReserveStep[];
	/** One line per ticket type, in id order, priced from the catalog. */
	lines: BookingLine[];
	totals: BookingDoc["totals"];
	paid: boolean;
}

export type CheckoutError = { code: "SALES_CLOSED" } | { code: "SOLD_OUT" } | { code: "BAD_REQUEST"; reason: string };

const inWindow = (now: number, start?: string | null, end?: string | null) =>
	!(start && now < Date.parse(start)) && !(end && now >= Date.parse(end));

function mergeLines(lines: ReserveInput["lines"]): Map<string, number> {
	const merged = new Map<string, number>();
	for (const line of lines) merged.set(line.ticketTypeId, (merged.get(line.ticketTypeId) ?? 0) + line.qty);
	return new Map([...merged].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Check an order against the event config and its catalog at `now`, and plan the reservation.
 * `maxSteps` is the bridge-call budget left for the reservation's forward steps (compensation is
 * bounded by the route and otherwise left to the sweeper).
 */
export function planCheckout(
	eventId: string,
	config: EventConfigDoc,
	input: ReserveInput,
	now: number,
	{ maxSteps }: { maxSteps: number },
): Result<CheckoutPlan, CheckoutError> {
	const closed = err({ code: "SALES_CLOSED" as const });
	const bad = (reason: string) => err({ code: "BAD_REQUEST" as const, reason });
	if (config.status !== "on_sale" || !inWindow(now, config.salesStart, config.salesEnd)) return closed;

	const types = config.catalog?.ticketTypes ?? {};
	const occurrences = config.catalog?.occurrences ?? {};
	const merged = mergeLines(input.lines);
	const counters = new Map<string, Counter>();
	const lines: BookingLine[] = [];
	for (const [ticketTypeId, qty] of merged) {
		const type = Object.hasOwn(types, ticketTypeId) ? types[ticketTypeId] : undefined;
		if (!type || type.hidden) return bad("UNKNOWN_TICKET_TYPE");
		if (!inWindow(now, type.salesStart, type.salesEnd)) return closed;
		if ((type.maxPerOrder != null && qty > type.maxPerOrder) || (type.minPerOrder != null && qty < type.minPerOrder)) {
			return bad("INVALID_QUANTITY");
		}
		counters.set(ticketTypeId, { capacity: type.capacity, reserved: 0 });
		lines.push({ ticketTypeId, qty, unitPriceMinor: type.priceMinor });
	}

	let occurrence: Counter | undefined;
	if (input.occurrenceId !== undefined) {
		const occ = Object.hasOwn(occurrences, input.occurrenceId) ? occurrences[input.occurrenceId] : undefined;
		if (!occ) return bad("UNKNOWN_OCCURRENCE");
		if (occ.status !== "open" || !(now < Date.parse(occ.startsAt))) return closed;
		occurrence = { capacity: occ.capacity, reserved: 0 };
	} else if (config.schedule || Object.keys(occurrences).length > 0) {
		return bad("OCCURRENCE_REQUIRED");
	}

	const planned = planReservation(
		{
			eventId,
			event: { capacity: config.capacity, reserved: config.reserved },
			...(input.occurrenceId !== undefined ? { occurrenceId: input.occurrenceId, occurrence } : {}),
			ticketTypes: counters,
			lines: [...merged].map(([ticketTypeId, qty]) => ({ ticketTypeId, qty })),
		},
		{ maxCalls: maxSteps, compensation: "bounded" },
	);
	if (!planned.ok) {
		return planned.error.code === "SOLD_OUT" ? err({ code: "SOLD_OUT" }) : bad(planned.error.reason);
	}
	const subtotalMinor = lines.reduce((sum, l) => sum + l.qty * l.unitPriceMinor, 0);
	return ok({
		steps: planned.value,
		lines,
		totals: { subtotalMinor, discountMinor: 0, totalMinor: subtotalMinor, currency: config.currency },
		paid: subtotalMinor > 0,
	});
}

/** Whether a stored booking is the order a resubmit describes (same event, occurrence, buyer, seats). */
export function sameOrder(
	booking: Pick<BookingDoc, "eventId" | "occurrenceId" | "email" | "lines">,
	input: ReserveInput,
): boolean {
	if (booking.eventId !== input.eventId || (booking.occurrenceId ?? undefined) !== input.occurrenceId) return false;
	if (booking.email !== input.buyer.email.trim().toLowerCase()) return false;
	const stored = mergeLines(booking.lines);
	const asked = mergeLines(input.lines);
	return stored.size === asked.size && [...asked].every(([id, qty]) => stored.get(id) === qty);
}

/** Start of the rate-limit window ending at `now`. */
export function rateWindowStart(now: number): string {
	return new Date(now - RESERVE_RATE_LIMIT.windowMs).toISOString();
}
