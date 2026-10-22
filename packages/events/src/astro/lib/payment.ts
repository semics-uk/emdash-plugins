/**
 * What the booking page says about a paid booking (EU-FR-09). Pure: the state comes only from the
 * core's `public/booking` answer. Stripe sends the buyer back to `/booking?ref=` on success and on
 * cancel alike, with nothing in the URL to trust, so "paid", "abandoned" and "webhook still on its
 * way" are told apart by asking the core, never by a query parameter.
 */
import { type MessageKey, t } from "../../i18n/index";
import type { BookingView } from "./widget";

export type PaymentState = "confirmed" | "pending" | "expired" | "cancelled" | "refunded" | "refunded_unavailable";

export interface PaymentView {
	state: PaymentState;
	heading: string;
	body: string;
	/** The page re-reads the booking for a while (the webhook has not arrived yet). */
	poll: boolean;
	/** Offer "Pay now": the seats are still held and the payment has not been confirmed. */
	resume: boolean;
}

const utc = (iso: string, locale: string) => {
	try {
		const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
		return t(locale, "time.utc", { time: at.format(new Date(iso)) });
	} catch {
		return iso;
	}
};

/** The provider's payment page is followed only when it is an `https:` URL (never `javascript:` or `//host`). */
export function isPayUrl(value: unknown): value is string {
	if (typeof value !== "string" || !value.startsWith("https://")) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

const final = (state: PaymentState, locale: string): PaymentView => ({
	state,
	heading: t(locale, `payment.${state}.heading` as MessageKey),
	body: t(locale, `payment.${state}.body` as MessageKey),
	poll: false,
	resume: false,
});

/** The payment section for a booking, or `null` when there is nothing to say about money. */
export function paymentView(booking: BookingView, locale = "en-GB"): PaymentView | null {
	const paid = booking.totals.totalMinor > 0;
	switch (booking.status) {
		case "awaiting_payment":
			return {
				state: "pending",
				heading: t(locale, "payment.pending.heading"),
				body: booking.holdExpiresAt
					? t(locale, "payment.pending.bodyUntil", { time: utc(booking.holdExpiresAt, locale) })
					: t(locale, "payment.pending.body"),
				poll: true,
				resume: true,
			};
		case "confirmed":
		case "expired":
		case "cancelled":
			return paid ? final(booking.status, locale) : null;
		case "refunded":
		case "refunded_unavailable":
			return final(booking.status, locale);
		default:
			return null;
	}
}
