/**
 * Server-side helpers for the booking widget, status page, pass and calendar link (T055). Pure, so
 * the components stay thin. `src/client/booking.ts` mirrors `validateCheckoutFields` (a test keeps
 * them in step) because the client script ships without imports.
 */

/** What `GET public/event` answers for one event (T046 implements the route to this shape). */
export interface PublicEvent {
	eventId: string;
	title?: string;
	status: "draft" | "on_sale" | "paused" | "closed" | "cancelled";
	currency: string;
	/** IANA zone the event's dates are shown in (the entry's `timezone` field). */
	timezone?: string;
	/** The event's own start, end and venue (the mapped entry fields), when the core has them. */
	startsAt?: string;
	endsAt?: string | null;
	venue?: string | null;
	ticketTypes: Array<{
		id: string;
		name: string;
		priceMinor: number;
		/** Seats left; `null` when not shown. */
		available?: number | null;
		minPerOrder?: number | null;
		maxPerOrder?: number | null;
	}>;
	occurrences?: Array<{ id: string; startsAt: string; endsAt?: string | null; available?: number | null }>;
	/** Public Turnstile site key, when the site owner configured one. */
	turnstileSiteKey?: string;
	/** True when the event requires a signed waiver (T066): the booking form then asks for attendees. */
	waiver?: boolean;
	/** True when the core takes promo codes (Events Pro, T078): the widget then shows a code field. */
	promoCodes?: boolean;
	/** True when a sold-out event takes a waitlist (T081): the widget then shows a "Join the waitlist" form. */
	waitlist?: boolean;
	/** Custom attendee questions (Events Pro, T080): the buyer answers them once per booking. */
	questions?: PublicQuestion[];
}

/** One custom question as `public/event` lists it (EV-FR-15). */
export interface PublicQuestion {
	id: string;
	label: string;
	type: "text" | "select" | "checkbox";
	required: boolean;
	/** The choices of a `select` question. */
	options?: string[];
}

/** What `POST public/booking` answers (T049), plus the optional fields later tasks add. */
export interface BookingView {
	bookingRef: string;
	status: string;
	eventId?: string;
	lines: Array<{ ticketTypeId: string; qty: number }>;
	totals: { totalMinor: number; currency: string };
	holdExpiresAt?: string;
	attendees: Array<{ name: string; ticketTypeId?: string; status: string; code?: string }>;
	canCancel: boolean;
	cancelBy?: string;
	/** A short-lived signed query for `public/booking/ics`, issued by the core (T050). */
	calendar?: { query?: string };
	/**
	 * While a waiver booking waits for signatures (T066): the refs still unsigned, and with Pro a signed
	 * receipt-lookup request for each, which the suite's reconciliation sends to e-sign.
	 */
	waiver?: { refs: string[]; lookups?: Record<string, string> };
}

/** A custom question's field is `q:<question id>` (T080). */
export type QuestionField = `q:${string}`;
export type WidgetField = "occurrence" | "promo" | "tickets" | "name" | "email" | QuestionField;

/** Question ids safe in HTML ids, field names and the widget's error URL. */
export const QUESTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** In form order: the first one is where focus goes. */
export const WIDGET_FIELDS = ["occurrence", "promo", "tickets", "name", "email"] as const;

export const WIDGET_PARAMS = { error: "booking_error", fields: "booking_fields", event: "booking_event" } as const;

/** The key reserve accepts (`src/domain/checkout.ts`). */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export const FIELD_MESSAGES: Record<(typeof WIDGET_FIELDS)[number], string> = {
	occurrence: "Choose a date.",
	promo: "Check the code, or leave it empty.",
	tickets: "Choose at least one ticket.",
	name: "Enter your name.",
	email: "Enter a valid email address.",
};

export const ERROR_MESSAGES: Record<string, string> = {
	BAD_REQUEST: "Please check the highlighted details.",
	SOLD_OUT: "Sorry, there are not enough tickets left for that order.",
	SALES_CLOSED: "Ticket sales for this event are closed.",
	RATE_LIMITED: "Too many bookings from this connection. Please wait a few minutes and try again.",
	TURNSTILE_FAILED: "The security check did not pass. Please try again.",
	HOLD_EXPIRED: "Your hold on these tickets expired. Please start again.",
	NOT_FOUND: "This event is not taking bookings.",
	PROMO_INVALID: "That code is not valid for this event.",
	PROMO_EXHAUSTED: "That code has been used up.",
	PROMO_ORDER_TOO_LARGE: "That code can't be used on an order this large. Order fewer ticket types at once.",
	PROMO_UNAVAILABLE: "That code can't be used right now. Remove it to book without it.",
	INTERNAL: "Something went wrong. Please try again.",
};

export const errorMessage = (code: string) => ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL;

/** A refusal of an order or check with a code: Pro's licence codes (it lapsed) mean the code can't be used (T120). */
export const promoRefusal = (code: string) => (code.startsWith("LICENCE_") ? "PROMO_UNAVAILABLE" : code);

/** 32 random bytes as 43 unpadded base64url characters: a fresh key for each checkout attempt. */
export function newIdempotencyKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

/** The widget's element id, safe in HTML ids, CSS selectors and URL fragments. */
export function anchorId(eventId: string): string {
	return `semics-booking-${eventId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * A same-site path to send the buyer back to, or `undefined`. Refuses absolute and
 * protocol-relative URLs (no open redirect) and the checkout endpoint itself, and drops earlier
 * widget error parameters and the fragment.
 */
export function safeReturnTo(raw: string, origin: string): string | undefined {
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
	let url: URL;
	try {
		url = new URL(raw, origin);
	} catch {
		return undefined;
	}
	// `/.//x` and `/%2e//x` resolve to `//x`: as a Location that is another host (T119 F11).
	if (url.origin !== origin || url.pathname.startsWith("//") || url.pathname.startsWith("/_events/")) return undefined;
	for (const name of Object.values(WIDGET_PARAMS)) url.searchParams.delete(name);
	return `${url.pathname}${url.search}`;
}

/** Where a refused checkout goes: back to the widget with a code and the fields to fix. No values. */
export function widgetErrorLocation(
	returnTo: string,
	eventId: string,
	code: string,
	fields: readonly WidgetField[],
): string {
	const url = new URL(returnTo, "http://x");
	url.searchParams.set(WIDGET_PARAMS.error, code);
	if (fields.length > 0) url.searchParams.set(WIDGET_PARAMS.fields, fields.join(","));
	url.searchParams.set(WIDGET_PARAMS.event, eventId);
	return `${url.pathname}${url.search}#${anchorId(eventId)}`;
}

/** The error a widget shows after a no-JS round trip; only for the widget of `eventId`. */
export function readWidgetState(url: URL, eventId: string): { code?: string; fields: WidgetField[] } {
	const raw = url.searchParams.get(WIDGET_PARAMS.error);
	if (!raw || url.searchParams.get(WIDGET_PARAMS.event) !== eventId) return { fields: [] };
	const code = Object.hasOwn(ERROR_MESSAGES, raw) ? raw : "INTERNAL";
	const asked = new Set((url.searchParams.get(WIDGET_PARAMS.fields) ?? "").split(","));
	const questions = [...asked].filter((f): f is QuestionField => f.startsWith("q:") && QUESTION_ID.test(f.slice(2)));
	return { code, fields: [...WIDGET_FIELDS.filter((f) => asked.has(f)), ...questions] };
}

export interface CheckoutFieldValues {
	name: string;
	email: string;
	/** Ticket lines with a quantity above zero. */
	lines: number;
	needsOccurrence: boolean;
	occurrenceId: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The fields to fix before checkout is worth a call; reserve's own validation is the authority. */
export function validateCheckoutFields(v: CheckoutFieldValues): WidgetField[] {
	const name = v.name.trim();
	const email = v.email.trim();
	const bad: WidgetField[] = [];
	if (v.needsOccurrence && !v.occurrenceId) bad.push("occurrence");
	if (v.lines < 1) bad.push("tickets");
	if (name.length < 1 || name.length > 200) bad.push("name");
	if (email.length > 254 || !EMAIL.test(email)) bad.push("email");
	return bad;
}

const ISSUE_FIELDS: Array<[RegExp, WidgetField]> = [
	[/^occurrenceId/, "occurrence"],
	[/^lines/, "tickets"],
	[/^buyer\.name/, "name"],
	[/^buyer\.email/, "email"],
];

/** Reserve's validation issues (`{ path, code }`) as widget fields, each once. */
export function fieldsFromIssues(issues: ReadonlyArray<{ path?: unknown; code?: unknown }> | undefined): WidgetField[] {
	const found = new Set<WidgetField>();
	for (const issue of issues ?? []) {
		const path = typeof issue.path === "string" ? issue.path : "";
		const hit = ISSUE_FIELDS.find(([pattern]) => pattern.test(path));
		const question = /^answers\.([^.]+)/.exec(path)?.[1];
		if (hit) found.add(hit[1]);
		else if (question && QUESTION_ID.test(question)) found.add(`q:${question}`);
	}
	return [...found];
}

const TOKEN_LIKE = /^(t|.*token.*|.*receipt.*|.*secret.*|.*otp.*)$/i;

const routeBase = (pluginId: string) => `/_emdash/api/plugins/${encodeURIComponent(pluginId)}`;

/**
 * The booking's calendar file link, from the signed query the core issued (`signLink`). The UI
 * holds no secret and never signs: it only refuses a query that is unsigned, expired or carries a
 * token, so an access token can never end up in a calendar URL.
 */
export function bookingCalendarHref(input: {
	pluginId: string;
	query: string | undefined;
	now: number;
}): string | undefined {
	if (!input.query) return undefined;
	const query = new URLSearchParams(input.query);
	const exp = query.get("exp") ?? "";
	if (!query.get("sig") || !/^\d{1,15}$/.test(exp) || Number(exp) * 1000 <= input.now) return undefined;
	for (const name of query.keys()) if (TOKEN_LIKE.test(name)) return undefined;
	return `${routeBase(input.pluginId)}/public/booking/ics?${query}`;
}

/** The public event calendar file (no booking data, so no signature). */
export function eventCalendarHref(pluginId: string, eventId: string): string {
	return `${routeBase(pluginId)}/public/event/ics?${new URLSearchParams({ eventId })}`;
}

export function formatMoney(minor: number, currency: string, locale = "en-GB"): string {
	if (minor === 0) return "Free";
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
	} catch {
		return `${(minor / 100).toFixed(2)} ${currency}`;
	}
}

export const STATUS_LABELS: Record<string, string> = {
	draft: "Started",
	held: "Held for you",
	awaiting_signature: "Waiting for signatures",
	awaiting_payment: "Waiting for payment",
	confirmed: "Confirmed",
	expired: "Expired",
	cancelled: "Cancelled",
	refunded: "Refunded",
	refunded_unavailable: "Refunded",
};

export const statusLabel = (status: string) => STATUS_LABELS[status] ?? status;
