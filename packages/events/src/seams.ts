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
 */
export {
	type ContinueSteps,
	checkoutContinueRoute,
	type PaymentStep,
	type SignatureStep,
	type SigningIntentOut,
	type SigningIssuer,
	type SigningRefusal,
} from "./routes/checkout-continue";
export { type EditorSteps, editorTicketsRoute } from "./routes/editor";
export type { WaiverAvailability, WaiverCheck } from "./admin/panel";
export type { AttendeeDoc, BookingDoc, BookingWaiver, SignatureMode } from "./storage/schema";
export type { InputIssue } from "./domain/checkout";
