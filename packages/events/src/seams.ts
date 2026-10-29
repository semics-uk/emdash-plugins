/**
 * Extension points for an edition built on this core (BUILD-PLAN §13, R41). The Free plugin uses
 * none of them; a superset build of the same slug composes the Free routes it replaces from these
 * factories, so it never copies booking rules. Each seam is MIT and does nothing on its own.
 *
 * - `checkoutContinueRoute({ payment, signature })`: `public/checkout/continue` with a payment step
 *   and/or a signature (waiver) step. Free leaves both empty: a paid booking is refused with
 *   `PAYMENT_FAILED`, and a booking's `waiver` is ignored.
 * - `editorTicketsRoute({ waivers })`: the "Tickets & booking" panel with a waiver availability
 *   check. Free shows required waivers as unavailable.
 * - `signaturesReceiptRoute({ receipts })`: `signatures/receipt` with a receipt step that verifies
 *   e-sign receipts and names the attendees a booking waits for; the core stores receipts and moves
 *   the booking on (T064). Free declares the route as a stub that answers NOT_FOUND.
 * - `bookingStatusRoute(lookups)`: `public/booking` with a step that mints e-sign receipt-lookup requests
 *   for the refs a waiver booking still waits for (T066). Free has none: the answer lists the refs only.
 * - `bookingCancelRoute(refund)`: `public/booking/cancel` with a refund step for paid bookings (T075). Free
 *   has none and refuses to cancel a paid confirmed booking.
 * - `adminRoute({ signingLink })`: the Block Kit admin with a signing link for attendees that
 *   check-in refuses because their waiver is pending. Free refuses them without a link.
 * - `useErrorCodes(ERROR_CODES)`: answer every shared error code, not only Events' own (R95). Call it
 *   once at load in an edition whose steps answer other codes (receipts: the protocol's); otherwise
 *   such a code answers `INTERNAL`.
 */

export type { SigningLink } from "./admin/pages";
export type { WaiverAvailability, WaiverCheck } from "./admin/panel";
export type { InputIssue } from "./domain/checkout";
export type { ReceiptStatus, VerifiedReceipt } from "./domain/receipts";
export { type AdminSteps, adminRoute } from "./routes/admin";
export { bookingCancelRoute, bookingStatusRoute, type LookupStep, type RefundStep } from "./routes/booking";
export {
	type ContinueSteps,
	checkoutContinueRoute,
	type PaymentStarter,
	type PaymentStep,
	type SignatureStep,
	type SigningIntentOut,
	type SigningIssuer,
	type SigningRefusal,
} from "./routes/checkout-continue";
export { type EditorSteps, editorTicketsRoute } from "./routes/editor";
export { type ReceiptAttendee, type ReceiptStep, type ReceiptSteps, signaturesReceiptRoute } from "./routes/receipt";
export { useErrorCodes } from "./routes/reply";
export type { AttendeeDoc, BookingDoc, BookingWaiver, SignatureMode } from "./storage/schema";
