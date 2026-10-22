/**
 * Typed storage collection names and document shapes (BUILD-PLAN 3.1).
 *
 * The manifest (`emdash-plugin.jsonc`) is the source of truth for what the host accepts;
 * `STORAGE_COLLECTIONS` mirrors it and a test fails if they drift. Every document stays under
 * 512 KiB (spike S4). Collection names must match `^[a-z][a-z0-9_]*$` (manifest schema), so the
 * BUILD-PLAN's camelCase names are snake_case here: `event_configs`, `ticket_types`, `promo_codes`. Timestamps are ISO 8601 UTC strings; money is integer minor units.
 *
 * Counted documents (event configs, occurrences, ticket types) are edited with a guarded `updateIf`
 * merge, which cannot remove a key, so an optional field cleared in the admin is stored as `null`:
 * readers treat `null` as absent. Their `reserved`/`sold` counters are written only by
 * `src/domain/inventory.ts`.
 */

/** A single-field index, or a composite index (order matters for ordering queries). */
export type IndexDef = string | readonly string[];

export interface CollectionDef {
	readonly indexes: readonly IndexDef[];
	readonly uniqueIndexes: readonly string[];
}

export const STORAGE_COLLECTIONS = {
	event_configs: { indexes: ["status", "salesEnd"], uniqueIndexes: [] },
	occurrences: { indexes: [["eventId", "startsAt"], "startsAt", "status"], uniqueIndexes: [] },
	ticket_types: { indexes: ["eventId"], uniqueIndexes: [] },
	bookings: {
		indexes: [
			"eventId",
			"status",
			"email",
			"createdAt",
			["status", "holdExpiresAt"],
			["eventId", "status"],
			["ipHash", "createdAt"],
		],
		uniqueIndexes: ["ref"],
	},
	// id = `<provider>:<sessionId>`: the document id is the webhook idempotency key.
	payments: { indexes: ["bookingId"], uniqueIndexes: [] },
	attendees: {
		indexes: ["bookingId", "eventId", "email", ["eventId", "checkedInAt"]],
		uniqueIndexes: ["code"],
	},
	waitlist: { indexes: [["eventId", "status"], "offerExpiresAt"], uniqueIndexes: [] },
	promo_codes: { indexes: ["eventId"], uniqueIndexes: ["code"] },
	outbox: { indexes: [["status", "nextAttemptAt"]], uniqueIndexes: [] },
} as const satisfies Record<string, CollectionDef>;

export type CollectionName = keyof typeof STORAGE_COLLECTIONS;

export const COLLECTION_NAMES = Object.keys(STORAGE_COLLECTIONS) as CollectionName[];

/** Settings declared with `type: "secret"` in `admin.settingsSchema`. */
export const SECRET_SETTING_KEYS = ["turnstileSecretKey", "esignPairing"] as const;

export type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number];

export function paymentId(provider: string, sessionId: string): string {
	return `${provider}:${sessionId}`;
}

// --- document shapes -------------------------------------------------------------------------

export type EventStatus = "draft" | "on_sale" | "paused" | "closed" | "cancelled";
export type SignatureMode = "each_attendee" | "buyer";

export interface EventQuestion {
	id: string;
	label: string;
	type: "text" | "select" | "checkbox";
	required: boolean;
	options?: string[];
}

/** Keyed by the content entry ID. */
export interface EventConfigDoc {
	status: EventStatus;
	capacity: number;
	reserved: number;
	sold: number;
	salesStart?: string | null;
	salesEnd?: string | null;
	currency: string;
	questions: EventQuestion[];
	signature: { required: boolean; templateId?: string; mode: SignatureMode };
	waitlistEnabled: boolean;
	recurrence?: string | null;
	/** Set when the entry was permanently deleted while it still had bookings. */
	orphaned?: boolean;
	/** Set while the entry is unpublished: sales stop and the event leaves the public routes (T051). */
	unpublished?: boolean;
	/** Derived from the event's ticket types and occurrences by `config/save` (see `EventCatalog`). */
	catalog?: EventCatalog | null;
	/** The event's public info, copied from its content entry (see `src/domain/event-info.ts`). */
	info?: EventInfoDoc | null;
}

/** Title, times, zone and venue of an event as ISO strings; written by the content hook and `config/save`. */
export interface EventInfoDoc {
	title: string;
	startsAt: string;
	endsAt: string | null;
	timezone: string | null;
	venue: string | null;
}

/** What checkout needs from a ticket type, copied onto the event config. */
export type CatalogTicketType = Pick<
	TicketTypeDoc,
	"capacity" | "priceMinor" | "hidden" | "minPerOrder" | "maxPerOrder" | "salesStart" | "salesEnd"
>;

/** What checkout needs from an occurrence, copied onto the event config. */
export type CatalogOccurrence = Pick<OccurrenceDoc, "capacity" | "startsAt" | "status">;

/**
 * A denormalised copy of an event's ticket types and occurrences, written by `config/save` after
 * the documents themselves, so `public/checkout/reserve` plans an order from one read (R22). It
 * holds no counters. A stale capacity is safe: every reservation guard pins the capacity it was
 * planned with, so a mismatch fails as sold out and can never oversell.
 */
export interface EventCatalog {
	ticketTypes: Record<string, CatalogTicketType>;
	occurrences: Record<string, CatalogOccurrence>;
}

export type OccurrenceStatus = "open" | "closed" | "cancelled";

export interface OccurrenceDoc {
	eventId: string;
	startsAt: string;
	endsAt?: string | null;
	capacity: number;
	reserved: number;
	sold: number;
	status: OccurrenceStatus;
}

export interface TicketTypeDoc {
	eventId: string;
	name: string;
	priceMinor: number;
	capacity: number;
	reserved: number;
	sold: number;
	minPerOrder?: number | null;
	maxPerOrder?: number | null;
	salesStart?: string | null;
	salesEnd?: string | null;
	/** Hidden types are unlocked only by an `unlock` promo code. */
	hidden: boolean;
	sort: number;
}

export type BookingStatus =
	| "draft"
	| "held"
	| "awaiting_signature"
	| "awaiting_payment"
	| "confirmed"
	| "expired"
	| "cancelled"
	| "refunded"
	| "refunded_unavailable";

export interface BookingLine {
	ticketTypeId: string;
	qty: number;
	unitPriceMinor: number;
}

export interface BookingDoc {
	/** Short public reference, unique. */
	ref: string;
	eventId: string;
	occurrenceId?: string;
	status: BookingStatus;
	holdExpiresAt?: string;
	holdCeilingAt?: string;
	/** Set by the expirer that claimed this hold (T045); writers of held bookings guard on it being `null`. */
	releaseClaimedAt?: string | null;
	/** When the hold expired. */
	expiredAt?: string;
	/** When the booking was cancelled. */
	cancelledAt?: string;
	/** When checkout confirmed the booking. */
	confirmedAt?: string;
	buyer: { name: string; email: string };
	/** The buyer's email, denormalised to the top level because indexes read top-level fields. */
	email: string;
	lines: BookingLine[];
	totals: { subtotalMinor: number; discountMinor: number; totalMinor: number; currency: string };
	payment?: { provider: string; ref: string };
	answers: Record<string, string>;
	/** SHA-256 of the access token; the token itself is never stored. */
	accessTokenHash: string;
	/**
	 * SHA-256 of the one-time code in the emailed booking link (T050), or `null` once redeemed.
	 * The code is never stored; redeeming it mints a new access token and replaces `accessTokenHash`.
	 */
	redeemHash?: string | null;
	/** When the emailed code stops working. */
	redeemExpiresAt?: string | null;
	/**
	 * Salted hash of the client IP that created the booking (never the IP): checkout's rate limit
	 * counts recent bookings by it. Erased with the booking's personal data.
	 */
	ipHash?: string;
	createdAt: string;
}

export type PaymentStatus = "pending" | "paid" | "expired" | "refunded" | "partially_refunded";

export interface PaymentDoc {
	bookingId: string;
	provider: string;
	status: PaymentStatus;
	amountMinor: number;
	currency: string;
	refundedMinor: number;
	events: Array<{ type: string; at: string }>;
}

export type AttendeeStatus = "pending" | "valid" | "cancelled";

export interface AttendeeDoc {
	bookingId: string;
	eventId: string;
	occurrenceId?: string;
	ticketTypeId: string;
	name: string;
	email: string;
	/** Unique check-in code. */
	code: string;
	status: AttendeeStatus;
	checkedInAt?: string;
	signature?: {
		envelopeId: string;
		status: string;
		docSha256?: string;
		pdfSha256?: string;
		signedBy?: "self" | "guardian" | "buyer";
	};
}

export type WaitlistStatus = "waiting" | "offered" | "claimed" | "expired" | "cancelled";

export interface WaitlistDoc {
	eventId: string;
	occurrenceId?: string;
	email: string;
	qty: number;
	status: WaitlistStatus;
	offerExpiresAt?: string;
	createdAt: string;
}

export type PromoKind = "percent" | "fixed" | "unlock";

export interface PromoCodeDoc {
	/** Unique, stored upper-case. */
	code: string;
	eventId?: string;
	kind: PromoKind;
	amount: number;
	maxUses?: number;
	uses: number;
	validFrom?: string;
	validTo?: string;
}

export type OutboxStatus = "pending" | "sent" | "failed";

/**
 * A queued email. It holds references only (`payload` ids); the message is rendered when it is
 * sent (`src/emails/outbox.ts` adapts this to the shared `OutboxRecord`: ISO `nextAttemptAt` here,
 * epoch ms there), so the row never carries a token, a ticket code or a body.
 */
export interface OutboxDoc {
	kind: string;
	to: string;
	payload: Record<string, unknown>;
	attempts: number;
	nextAttemptAt: string;
	status: OutboxStatus;
	lastError?: string;
	sentAt?: string;
}

/** Document shape for each collection, for typed `ctx.storage` access in later tasks. */
export interface CollectionDocs {
	event_configs: EventConfigDoc;
	occurrences: OccurrenceDoc;
	ticket_types: TicketTypeDoc;
	bookings: BookingDoc;
	payments: PaymentDoc;
	attendees: AttendeeDoc;
	waitlist: WaitlistDoc;
	promo_codes: PromoCodeDoc;
	outbox: OutboxDoc;
}
