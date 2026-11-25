/**
 * "Book with this voucher" (T171): what the booking forms need to take a buyer straight from a gift voucher to a
 * booking. voucher/1 §8 keeps a code out of every URL but the voucher page's own, so the suite's voucher page
 * (`/_vouchers/v?c=…&book=1`) puts the code in this short-lived HttpOnly cookie and redirects here; the form
 * fills its Gift voucher field from it on the server (no JavaScript). `?ticketType=` chooses a ticket type, and
 * `#book-<event>` lands on the form. Site-side only: nothing here reaches the sandboxed core.
 */

export const VOUCHER_COOKIE = "semics_voucher";
export const VOUCHER_COOKIE_SECONDS = 30 * 60;
export const TICKET_TYPE_PARAM = "ticketType";

/** A code in its display form, `XXXX-XXXX-XXXX-XXXX` (voucher/1 §7). */
const DISPLAY_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

/** The voucher cookie: HttpOnly, the whole site (the form can be on any page), 30 minutes. */
export function voucherCookieOptions(url: URL) {
	return {
		path: "/",
		httpOnly: true,
		sameSite: "lax" as const,
		secure: url.protocol === "https:",
		maxAge: VOUCHER_COOKIE_SECONDS,
	};
}

/** The code to fill in from the cookie, or "" (none, malformed, or a prerendered page with no cookies). */
export function presetVoucher(cookies: { get(name: string): { value: string } | undefined } | undefined): string {
	try {
		const value = cookies?.get(VOUCHER_COOKIE)?.value ?? "";
		return DISPLAY_CODE.test(value) ? value : "";
	} catch {
		// No cookie API here: no code to carry.
		return "";
	}
}

/** `?ticketType=` when the form offers that type. */
export function presetTicketType(url: URL, offered: readonly string[]): string | undefined {
	const id = url.searchParams.get(TICKET_TYPE_PARAM);
	return id && offered.includes(id) ? id : undefined;
}

/** The booking form's anchor, the same for `<BookingWidget>` and the suite's `<BookingWithWaiver>`. */
export function bookAnchor(eventId: string): string {
	return `book-${eventId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}
