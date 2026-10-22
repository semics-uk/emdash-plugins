/**
 * Extension points for an edition built on this core (BUILD-PLAN §13, R41). The Free plugin uses
 * none of them; a superset build of the same slug composes the Free routes it replaces from these
 * factories, so it never copies the ceremony's rules. Each seam is MIT and does nothing on its own.
 *
 * - `ceremonyHandlers(several)`: `public/session`, `public/submit` and `public/decline` with a step
 *   that signs an envelope with several signers (T090). Submit validates the signature exactly as
 *   for one signer (token, document hash, consent wording, entered values) and hands the signer's
 *   signed record to the step. Free has none: such an envelope (a site switched back from Pro keeps
 *   it) is refused with `ENVELOPE_CLOSED` and nothing is written.
 */

export { ceremonyHandlers, type SeveralSigners, type SeveralSignersStep } from "./routes/ceremony";
