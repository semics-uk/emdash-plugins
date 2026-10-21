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
// zod/mini: the same validators with a tree-shakable API, about a fifth of zod's bundle size.
import { z } from "zod/mini";

import type { BookingDoc, BookingLine, EventConfigDoc } from "../storage/schema";
import { type Counter, planReservation, type ReserveStep } from "./inventory";

/** Most lines and seats per line one order may carry. */
export const MAX_LINES = 10;
export const MAX_QTY_PER_LINE = 50;

/** Bookings one client IP may create per sliding window (EV-FR-05: spam bookings, inventory abuse). */
export const RESERVE_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 } as const;

const docId = z.string().check(z.minLength(1), z.maxLength(200));

/**
 * The request body. `idempotencyKey` is a client-generated secret (at least 32 URL-safe characters,
 * new for each checkout attempt): it names the booking, so a resubmit finds it again. Unknown keys
 * are refused.
 */
export const reserveInputSchema = z.strictObject({
	eventId: docId,
	occurrenceId: z.optional(docId),
	lines: z
		.array(
			z.strictObject({
				ticketTypeId: docId,
				qty: z.int().check(z.minimum(1), z.maximum(MAX_QTY_PER_LINE)),
			}),
		)
		.check(z.minLength(1), z.maxLength(MAX_LINES)),
	buyer: z.strictObject({
		name: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
		email: z.pipe(z.string().check(z.trim(), z.toLowerCase(), z.maxLength(254)), z.email()),
	}),
	idempotencyKey: z.string().check(z.regex(/^[A-Za-z0-9_-]{32,128}$/)),
	turnstileToken: z.optional(z.string().check(z.maxLength(2048))),
});

export type ReserveInput = z.output<typeof reserveInputSchema>;

/**
 * The `public/checkout/continue` body: the booking's public ref and the access token reserve
 * returned (in the body, never the URL), plus the attendee details. Without `attendees` every seat
 * is in the buyer's name.
 */
export const continueInputSchema = z.strictObject({
	bookingRef: z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{10}$/)),
	accessToken: z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/)),
	attendees: z.optional(
		z
			.array(
				z.strictObject({
					ticketTypeId: docId,
					name: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
					email: z.optional(z.pipe(z.string().check(z.trim(), z.toLowerCase(), z.maxLength(254)), z.email())),
				}),
			)
			.check(z.minLength(1), z.maxLength(MAX_LINES * MAX_QTY_PER_LINE)),
	),
});

/** The `public/booking` and `public/booking/cancel` body: the booking ref and access token only. */
export const bookingAccessSchema = z.strictObject({
	bookingRef: continueInputSchema.shape.bookingRef,
	accessToken: continueInputSchema.shape.accessToken,
});

export type BookingAccessInput = z.output<typeof bookingAccessSchema>;

export type ContinueInput = z.output<typeof continueInputSchema>;

export interface InputIssue {
	path: string;
	code: string;
}

export function parseReserveInput(raw: unknown): Result<ReserveInput, InputIssue[]> {
	return parseWith(reserveInputSchema, raw);
}

export function parseBookingAccessInput(raw: unknown): Result<BookingAccessInput, InputIssue[]> {
	return parseWith(bookingAccessSchema, raw);
}

export function parseContinueInput(raw: unknown): Result<ContinueInput, InputIssue[]> {
	return parseWith(continueInputSchema, raw);
}

function parseWith<S extends z.ZodMiniType>(schema: S, raw: unknown): Result<z.output<S>, InputIssue[]> {
	const parsed = schema.safeParse(raw);
	if (parsed.success) return ok(parsed.data);
	return err(
		parsed.error.issues.map((issue) => ({
			path: issue.path.length > 0 ? issue.path.join(".") : "input",
			code: issue.code,
		})),
	);
}

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
	} else if (Object.keys(occurrences).length > 0) {
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
