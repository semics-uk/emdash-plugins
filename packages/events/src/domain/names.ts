/**
 * Names the backend repeats: storage statuses and the error codes routes answer with. The minifier
 * cannot shorten a string, so each one lives here once and every use is a short identifier in the
 * sandbox bundle (R100, T162). Values never change: they are stored fields and API codes.
 */

// --- booking statuses (lifecycle order: `STATUSES` in inventory.ts) ---
export const DRAFT = "draft" as const;
export const HELD = "held" as const;
export const AWAITING_SIGNATURE = "awaiting_signature" as const;
export const AWAITING_PAYMENT = "awaiting_payment" as const;
export const AWAITING_APPROVAL = "awaiting_approval" as const;
export const CONFIRMED = "confirmed" as const;
export const EXPIRED = "expired" as const;
export const CANCELLED = "cancelled" as const;

// --- event, occurrence, attendee and waitlist statuses ---
export const ON_SALE = "on_sale" as const;
export const OPEN = "open" as const;
export const CLOSED = "closed" as const;
export const PENDING = "pending" as const;
export const OFFERED = "offered" as const;
export const EACH_ATTENDEE = "each_attendee" as const;

// --- error codes ---
export const NOT_FOUND = "NOT_FOUND" as const;
export const BAD_REQUEST = "BAD_REQUEST" as const;
export const INTERNAL = "INTERNAL" as const;
export const INVALID_INPUT = "INVALID_INPUT" as const;
export const HOLD_EXPIRED = "HOLD_EXPIRED" as const;
export const SOLD_OUT = "SOLD_OUT" as const;
export const TURNSTILE_FAILED = "TURNSTILE_FAILED" as const;
export const CANCEL_NOT_ALLOWED = "CANCEL_NOT_ALLOWED" as const;
export const ALREADY_CHECKED_IN = "ALREADY_CHECKED_IN" as const;
export const INVALID_QUANTITY_LIMITS = "INVALID_QUANTITY_LIMITS" as const;
export const CAPACITY_BELOW_RESERVED = "CAPACITY_BELOW_RESERVED" as const;
export const TOO_MANY_CHANGES = "TOO_MANY_CHANGES" as const;
export const PAYMENT_FAILED = "PAYMENT_FAILED" as const;
export const WAIVER_PENDING = "WAIVER_PENDING" as const;
