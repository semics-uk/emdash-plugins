/**
 * What the booking page says about a paid booking (EU-FR-09). Pure: the state comes only from the
 * core's `public/booking` answer. Stripe sends the buyer back to `/booking?ref=` on success and on
 * cancel alike, with nothing in the URL to trust, so "paid", "abandoned" and "webhook still on its
 * way" are told apart by asking the core, never by a query parameter.
 */
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

const UTC = (iso: string) => {
	try {
		const at = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
		return `${at.format(new Date(iso))} UTC`;
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

const final = (state: PaymentState, heading: string, body: string): PaymentView => ({
	state,
	heading,
	body,
	poll: false,
	resume: false,
});

/** The payment section for a booking, or `null` when there is nothing to say about money. */
export function paymentView(booking: BookingView): PaymentView | null {
	const paid = booking.totals.totalMinor > 0;
	switch (booking.status) {
		case "awaiting_payment":
			return {
				state: "pending",
				heading: "Waiting for your payment",
				body: `If you have just paid, this page updates by itself within a minute and we will email you once the payment is confirmed. If you left the payment page, your tickets are held${
					booking.holdExpiresAt ? ` until ${UTC(booking.holdExpiresAt)}` : " for a short time"
				} and you can pay now.`,
				poll: true,
				resume: true,
			};
		case "confirmed":
			return paid
				? final("confirmed", "Payment received", "Thank you: your payment is confirmed and so is your booking.")
				: null;
		case "expired":
			return paid
				? final(
						"expired",
						"This booking expired",
						"The hold ran out before a payment was confirmed. If you were charged, the payment is refunded automatically, or the booking is confirmed if the tickets are still available. Otherwise, please start again from the event page.",
					)
				: null;
		case "cancelled":
			return paid
				? final(
						"cancelled",
						"Booking cancelled",
						"This booking was cancelled. Any payment is refunded to the original payment method.",
					)
				: null;
		case "refunded":
			return final("refunded", "Payment refunded", "Your payment was refunded to the original payment method.");
		case "refunded_unavailable":
			return final(
				"refunded_unavailable",
				"Payment refunded: tickets no longer available",
				"Your payment arrived after these tickets were no longer available, so it has been refunded in full. No tickets were issued.",
			);
		default:
			return null;
	}
}
