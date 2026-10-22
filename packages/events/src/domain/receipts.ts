/**
 * Waiver receipts (EV-FR-12, SX-FR-04; esign-intent/1 §8.4). Pure: which attendees a receipt's
 * `ref` names, and how a receipt is stored on an attendee so that processing is idempotent (the
 * same receipt twice changes nothing) and monotonic (a completed receipt is final).
 *
 * Refs: mode `each_attendee` signs one seat, `ref = <bookingRef>:<seat>` where the seat is the `n`
 * of the attendee document `<bookingId>-<n>`; mode `buyer` signs the booking, `ref = <bookingRef>`,
 * and its receipt covers every seat.
 */
import type { AttendeeDoc, BookingDoc } from "../storage/schema";
import { attendeeId } from "./booking-state";

export type ReceiptStatus = "completed" | "declined" | "voided" | "expired";

/** A receipt whose signature the Pro step has verified (§5.2 fields). */
export interface VerifiedReceipt {
	envelopeId: string;
	ref: string;
	status: ReceiptStatus;
	docSha256: string;
	pdfSha256: string | null;
	finalHash: string | null;
	/** When the envelope entered `status` (epoch seconds). */
	at: number;
}

export type AttendeeSignature = NonNullable<AttendeeDoc["signature"]>;

const REF = /^([0-9A-HJKMNP-TV-Z]{10})(?::([1-9][0-9]{0,3}))?$/;

export function parseReceiptRef(ref: string): { bookingRef: string; seat?: number } | null {
	const m = REF.exec(ref);
	if (!m) return null;
	return m[2] ? { bookingRef: m[1] as string, seat: Number(m[2]) } : { bookingRef: m[1] as string };
}

/** Every attendee document of a booking: one per seat, `<bookingId>-1..n`. */
export function seatIds(bookingId: string, booking: { lines: ReadonlyArray<{ qty: number }> }): string[] {
	const total = booking.lines.reduce((sum, line) => sum + line.qty, 0);
	return Array.from({ length: total }, (_, i) => attendeeId(bookingId, i + 1));
}

/** The attendees a receipt signs for, or `null` when the booking never issued that ref. */
export function receiptAttendeeIds(
	bookingId: string,
	booking: Pick<BookingDoc, "waiver"> & { lines: ReadonlyArray<{ qty: number }> },
	ref: { bookingRef?: string; seat?: number },
): string[] | null {
	const seats = seatIds(bookingId, booking);
	if (booking.waiver?.mode === "buyer") return ref.seat === undefined ? seats : null;
	if (booking.waiver?.mode !== "each_attendee" || ref.seat === undefined || ref.seat > seats.length) return null;
	return [attendeeId(bookingId, ref.seat)];
}

const asStored = (r: VerifiedReceipt): AttendeeSignature => ({
	envelopeId: r.envelopeId,
	status: r.status,
	docSha256: r.docSha256,
	pdfSha256: r.pdfSha256,
	finalHash: r.finalHash,
	at: r.at,
});

/**
 * The signature to store for `receipt` given the one stored, or `null` when nothing changes:
 * - a completed signature is final; only the same envelope's receipt with the PDF hash (all else
 *   equal) supersedes one stored with `pdfSha256: null`;
 * - a completed receipt replaces a declined, voided or expired one;
 * - among non-completed receipts, a later `at` wins.
 */
export function mergeSignature(
	current: AttendeeSignature | undefined,
	receipt: VerifiedReceipt,
): AttendeeSignature | null {
	if (!current) return asStored(receipt);
	if (current.status === "completed") {
		const pdfArrives =
			receipt.status === "completed" &&
			current.pdfSha256 == null &&
			receipt.pdfSha256 !== null &&
			current.envelopeId === receipt.envelopeId &&
			current.docSha256 === receipt.docSha256 &&
			current.finalHash === receipt.finalHash &&
			current.at === receipt.at;
		return pdfArrives ? asStored(receipt) : null;
	}
	if (receipt.status === "completed") return asStored(receipt);
	return receipt.at > (current.at ?? 0) ? asStored(receipt) : null;
}
