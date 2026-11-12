/**
 * The booking form of `<BookingWithWaiver>` (SX-FR-02): the buyer, then one row per attendee
 * (ticket type, name, optional email, "under 18"). Read and checked here before anything is
 * reserved; the Events core stays the authority on every rule. Web APIs only (R35).
 */

/** The suite's page (injected by `suiteIntegration`): booking and inline signing. */
export const WAIVER_PATH = "/_events/waiver";
/** Attendee rows the widget offers (one booking holds at most this many seats). */
export const MAX_SEATS = 10;
export const DEFAULT_SEATS = 4;

export type SeatPart = "ticketTypeId" | "name" | "email" | "minor";
/** The form control (and field id) of one part of attendee row `row` (1-based). */
export const seatField = (row: number, part: SeatPart) => `attendee.${row}.${part}`;

/** Query parameters a refused booking returns to the widget with (codes and field names only). */
export const WAIVER_PARAMS = { error: "waiver_error", fields: "waiver_fields", event: "waiver_event" } as const;

/**
 * A C0 control character (U+0000-U+001F) or DEL (U+007F): esign-intent/1 §5 refuses them in a
 * `name`, so a name carrying one would only fail later, at e-sign, after the seats are held.
 */
export function hasControlCharacters(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const unit = value.charCodeAt(i);
		if (unit <= 0x1f || unit === 0x7f) return true;
	}
	return false;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface WaiverAttendee {
	ticketTypeId: string;
	name: string;
	email?: string;
	minor?: true;
}

export interface WaiverOrder {
	eventId: string;
	occurrenceId?: string;
	buyer: { name: string; email: string };
	attendees: WaiverAttendee[];
	/** Seats per ticket type, in the order the types first appear. */
	lines: Array<{ ticketTypeId: string; qty: number }>;
	/** The form row of each attendee, to point the core's issues back at the right row. */
	rows: number[];
	idempotencyKey: string;
	turnstileToken?: string;
}

export type WaiverFormResult =
	| { ok: true; order: WaiverOrder }
	| { ok: false; code: "BAD_REQUEST" | "CONTROL_CHARACTERS"; fields: string[] };

const text = (form: FormData, key: string) => {
	const value = form.get(key);
	return typeof value === "string" ? value.trim() : "";
};

/** Reads the widget's post; on a refusal, names the fields to fix (never their values). */
export function readWaiverForm(form: FormData): WaiverFormResult {
	const bad: string[] = [];
	let control = false;
	const check = (field: string, value: string, valid: boolean) => {
		if (hasControlCharacters(value)) {
			control = true;
			bad.push(field);
		} else if (!valid) bad.push(field);
	};

	const eventId = text(form, "eventId");
	if (!eventId) bad.push("event");
	const occurrenceId = text(form, "occurrenceId");
	if (form.get("needsOccurrence") === "1" && !occurrenceId) bad.push("occurrence");
	const buyer = { name: text(form, "name"), email: text(form, "email") };
	check("name", buyer.name, buyer.name.length >= 1 && buyer.name.length <= 200);
	check("email", buyer.email, buyer.email.length <= 254 && EMAIL.test(buyer.email));

	const attendees: WaiverAttendee[] = [];
	const rows: number[] = [];
	// An event that needs no waiver (T066) is booked by ticket type and quantity: no attendee rows.
	const plain = form.get("plain") === "1";
	const plainType = text(form, "ticketTypeId");
	const plainQty = Number(text(form, "qty"));
	if (plain && !(plainType && Number.isInteger(plainQty) && plainQty >= 1 && plainQty <= MAX_SEATS))
		bad.push("tickets");
	for (let row = 1; row <= (plain ? 0 : MAX_SEATS); row++) {
		const name = text(form, seatField(row, "name"));
		const email = text(form, seatField(row, "email"));
		const minor = form.get(seatField(row, "minor")) === "on";
		if (!name && !email && !minor) continue;
		const ticketTypeId = text(form, seatField(row, "ticketTypeId"));
		if (!ticketTypeId) bad.push(seatField(row, "ticketTypeId"));
		check(seatField(row, "name"), name, name.length >= 1 && name.length <= 200);
		if (email) check(seatField(row, "email"), email, email.length <= 254 && EMAIL.test(email));
		attendees.push({ ticketTypeId, name, ...(email ? { email } : {}), ...(minor ? { minor: true as const } : {}) });
		rows.push(row);
	}
	if (!plain && attendees.length === 0) bad.push("attendees");
	if (bad.length > 0) return { ok: false, code: control ? "CONTROL_CHARACTERS" : "BAD_REQUEST", fields: bad };

	const counts = new Map<string, number>(plain ? [[plainType, plainQty]] : []);
	for (const a of attendees) counts.set(a.ticketTypeId, (counts.get(a.ticketTypeId) ?? 0) + 1);
	const turnstileToken = text(form, "cf-turnstile-response");
	return {
		ok: true,
		order: {
			eventId,
			...(occurrenceId ? { occurrenceId } : {}),
			buyer,
			idempotencyKey: text(form, "idempotencyKey"),
			...(turnstileToken ? { turnstileToken } : {}),
			lines: [...counts].map(([ticketTypeId, qty]) => ({ ticketTypeId, qty })),
			attendees,
			rows,
		},
	};
}

/** Adults one order can have invited by email (Events Pro's `MAX_EMAIL_SIGNERS`). */
const MAX_EMAIL_SIGNERS = 10;
const norm = (value: string) => value.trim().toLowerCase();

/**
 * Events Pro's waiver rules for an event signed per attendee (`planWaiverIntents`), asked before anything is
 * reserved: an adult with the buyer's address (or none) must be the buyer, once; other adults are invited by
 * email, up to the limit; the buyer signs for minors. The core stays the authority: it checks again at continue.
 */
export function checkWaiverSeats(order: WaiverOrder): { code: string; fields: string[] } | null {
	const fields: string[] = [];
	let buyerSeated = false;
	let emailed = 0;
	for (const [i, a] of order.attendees.entries()) {
		if (a.minor) continue;
		if (norm(a.email ?? order.buyer.email) !== norm(order.buyer.email)) emailed++;
		else if (buyerSeated || norm(a.name) !== norm(order.buyer.name))
			fields.push(seatField(order.rows[i] ?? 0, "email"));
		else buyerSeated = true;
	}
	if (fields.length > 0) return { code: "WAIVER_EMAIL_REQUIRED", fields };
	return emailed > MAX_EMAIL_SIGNERS ? { code: "WAIVER_TOO_MANY_EMAILS", fields: [] } : null;
}

/** Messages for the codes a refused booking comes back with. */
export const WAIVER_MESSAGES: Record<string, string> = {
	BAD_REQUEST: "Please check the highlighted details.",
	CONTROL_CHARACTERS: "Names and emails cannot contain control characters (such as tabs or line breaks).",
	WAIVER_EMAIL_REQUIRED:
		"Every adult other than you needs their own email address, so they can sign their waiver themselves.",
	WAIVER_TOO_MANY_EMAILS:
		"One booking can invite at most 10 adults to sign by email. Please split the group into smaller bookings.",
	SOLD_OUT: "Sorry, there are not enough tickets left for that order.",
	SALES_CLOSED: "Ticket sales for this event are closed.",
	RATE_LIMITED: "Too many bookings from this connection. Please wait a few minutes and try again.",
	TURNSTILE_FAILED: "The security check did not pass. Please try again.",
	HOLD_EXPIRED: "Your hold on these tickets expired. Please start again.",
	BOOKING_EXPIRED: "This booking has expired. Please book again.",
	NOT_FOUND: "This event is not taking bookings.",
	SIGNING_UNAVAILABLE:
		"The waiver could not be opened for signing just now. Your tickets are still held for a short time: try again, or contact the organiser.",
	VOUCHER_INVALID: "That gift voucher code is not valid.",
	VOUCHER_NO_BALANCE: "That gift voucher has nothing left to spend.",
	VOUCHER_WRONG_ACTIVITY: "That gift voucher is for a different activity.",
	VOUCHER_CURRENCY: "That gift voucher is in a different currency.",
	VOUCHER_UNAVAILABLE: "Gift vouchers can't be used right now. Remove the code to book without it.",
	INTERNAL: "Something went wrong. Please try again.",
};

/**
 * The widget's words for the waiver order (T160, Events Pro's `waiverTiming`). Before payment (the default) the
 * note is today's and there are no numbered steps; after payment the note and the steps say pay, then sign.
 */
export function waiverCopy(afterPayment: boolean): { note: string; steps: string[] } {
	if (!afterPayment) {
		return {
			note: "List everyone attending, including you if you are going. You sign the waiver now, for yourself and for anyone under 18. Other adults need their own email address: they are sent their waiver to sign.",
			steps: [],
		};
	}
	return {
		note: "List everyone attending, including you if you are going. You pay first, then sign the waiver for yourself and for anyone under 18. Other adults need their own email address: they are sent their waiver to sign after you pay.",
		steps: ["Book", "Pay", "Sign the waiver"],
	};
}

/** The anchor of a widget, so a refusal scrolls back to it. */
export function waiverAnchor(eventId: string): string {
	return `semics-waiver-${eventId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** A same-site path to return to after a refusal; never another origin or one of the plugins' own routes. */
export function safeReturnPath(raw: string, origin: string): string | undefined {
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
	let url: URL;
	try {
		url = new URL(raw, origin);
	} catch {
		return undefined;
	}
	// `/.//x` and `/%2e//x` resolve to `//x`: as a Location that is another host (T119 F11).
	const path = url.pathname;
	if (url.origin !== origin || path.startsWith("//") || path.startsWith("/_events/") || path.startsWith("/_emdash/")) {
		return undefined;
	}
	for (const name of Object.values(WAIVER_PARAMS)) url.searchParams.delete(name);
	return `${url.pathname}${url.search}`;
}

/** Where a refused booking goes: back to the widget with a code and the fields to fix. No values. */
export function waiverErrorLocation(
	returnTo: string,
	eventId: string,
	code: string,
	fields: readonly string[],
): string {
	const url = new URL(returnTo, "http://x");
	url.searchParams.set(WAIVER_PARAMS.error, code);
	if (fields.length > 0) url.searchParams.set(WAIVER_PARAMS.fields, fields.join(","));
	url.searchParams.set(WAIVER_PARAMS.event, eventId);
	return `${url.pathname}${url.search}#${waiverAnchor(eventId)}`;
}

const KNOWN_FIELD = new RegExp(
	`^(event|occurrence|name|email|tickets|voucher|attendees|attendee\\.([1-9]|${MAX_SEATS})\\.(ticketTypeId|name|email))$`,
);

/** The refusal a widget shows after a round trip; only for the widget of `eventId`. */
export function readWaiverState(url: URL, eventId: string): { code?: string; fields: string[] } {
	const raw = url.searchParams.get(WAIVER_PARAMS.error);
	if (!raw || url.searchParams.get(WAIVER_PARAMS.event) !== eventId) return { fields: [] };
	const code = Object.hasOwn(WAIVER_MESSAGES, raw) ? raw : "INTERNAL";
	const fields = (url.searchParams.get(WAIVER_PARAMS.fields) ?? "").split(",").filter((f) => KNOWN_FIELD.test(f));
	return { code, fields };
}
