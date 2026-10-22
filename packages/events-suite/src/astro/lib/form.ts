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
	for (let row = 1; row <= MAX_SEATS; row++) {
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
	if (attendees.length === 0) bad.push("attendees");
	if (bad.length > 0) return { ok: false, code: control ? "CONTROL_CHARACTERS" : "BAD_REQUEST", fields: bad };

	const counts = new Map<string, number>();
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

/** Messages for the codes a refused booking comes back with. */
export const WAIVER_MESSAGES: Record<string, string> = {
	BAD_REQUEST: "Please check the highlighted details.",
	CONTROL_CHARACTERS: "Names and emails cannot contain control characters (such as tabs or line breaks).",
	WAIVER_EMAIL_REQUIRED:
		"Every adult other than you needs their own email address, so they can sign their waiver themselves.",
	SOLD_OUT: "Sorry, there are not enough tickets left for that order.",
	SALES_CLOSED: "Ticket sales for this event are closed.",
	RATE_LIMITED: "Too many bookings from this connection. Please wait a few minutes and try again.",
	TURNSTILE_FAILED: "The security check did not pass. Please try again.",
	HOLD_EXPIRED: "Your hold on these tickets expired. Please start again.",
	NOT_FOUND: "This event is not taking bookings.",
	SIGNING_UNAVAILABLE: "Waivers for this event cannot be signed online right now. Please contact the organiser.",
	INTERNAL: "Something went wrong. Please try again.",
};

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
	if (url.origin !== origin || url.pathname.startsWith("/_events/") || url.pathname.startsWith("/_emdash/")) {
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
	`^(event|occurrence|name|email|attendees|attendee\\.([1-9]|${MAX_SEATS})\\.(ticketTypeId|name|email))$`,
);

/** The refusal a widget shows after a round trip; only for the widget of `eventId`. */
export function readWaiverState(url: URL, eventId: string): { code?: string; fields: string[] } {
	const raw = url.searchParams.get(WAIVER_PARAMS.error);
	if (!raw || url.searchParams.get(WAIVER_PARAMS.event) !== eventId) return { fields: [] };
	const code = Object.hasOwn(WAIVER_MESSAGES, raw) ? raw : "INTERNAL";
	const fields = (url.searchParams.get(WAIVER_PARAMS.fields) ?? "").split(",").filter((f) => KNOWN_FIELD.test(f));
	return { code, fields };
}
