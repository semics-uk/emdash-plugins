---
id: T132
title: "Events Pro: hold the payment until a booking is approved"
phase: 7
package: events
edition: pro
status: in-progress
model: opus-5.5
size: L
depends_on: [T131]
spec: [R49]
---

# T132 · Events Pro: payment holds until approval

## Definition

With approval on (T131), Pro's Stripe step must not charge before approval. Stripe card authorisations
last about 7 days, so (decided here):
- occurrence starts within `authoriseWithinDays` (default and max 6) of booking: Checkout with
  `payment_intent_data.capture_method=manual`; Approve captures, Decline/deadline cancels the intent;
- later occurrences: Checkout in `setup` mode saving the card to a Stripe Customer; Approve creates and
  confirms an off-session PaymentIntent; if the bank needs the customer (`requires_action`/declined) the
  booking moves to `awaiting_payment` with a "Pay now" email (a normal Checkout) until the deadline.
The webhook/reconcile paths handle the new session modes and intent states idempotently; amount and
currency checks (R49) apply at capture/charge. Decline or expiry never charges. The deadline for a
manual-capture booking is also capped before the authorisation expires.

## Acceptance criteria

- [ ] Tests first (Stripe faked as the existing tests do): both modes chosen by date; approve captures/charges once (double approve, webhook replay); decline/expiry cancels; requires_action → Pay now; reconcile cron
- [ ] Free downgrade safe (Free keeps the 503 webhook stub, R44 settings declared in Free)
- [ ] Pro bundle and CPU budgets; decision recorded (next R); Pro README and CONTEXT updated; changesets in both repos
- [ ] T131 follow-ups (R97): Pro Stripe confirm calls `settle` (today a paid booking on an approval event is confirmed without waiting); pass `adminRoute({ refund })` so Decline refunds/cancels; an expired paid request is cancelled/refunded automatically; call `useErrorCodes(ERROR_CODES)` at load if Pro steps answer e-sign/protocol codes
- [ ] Retention erases `declineReason` with the booking's other personal data (Free, only if it fits the 190 B left; else record)
- [ ] Meets the Definition of Done (Pro repo `pnpm verify` too)
