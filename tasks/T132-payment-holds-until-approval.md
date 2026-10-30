---
id: T132
title: "Events Pro: hold the payment until a booking is approved"
phase: 7
package: events
edition: pro
status: done
model: opus-5.5
size: L
depends_on: [T131]
spec: [R49, R97, R98]
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

- [x] Tests first (Stripe faked as the existing tests do): both modes chosen by date; approve captures/charges once (double approve, webhook replay); decline/expiry cancels; requires_action → Pay now; reconcile cron
- [x] Free downgrade safe (Free keeps the 503 webhook stub, R44 settings declared in Free)
- [x] Pro bundle and CPU budgets; decision recorded (next R); Pro README and CONTEXT updated; changesets in both repos
- [x] T131 follow-ups (R97): Pro Stripe confirm calls `settle` (today a paid booking on an approval event is confirmed without waiting); pass `adminRoute({ refund })` so Decline refunds/cancels; an expired paid request is cancelled/refunded automatically; call `useErrorCodes(ERROR_CODES)` at load if Pro steps answer e-sign/protocol codes
- [x] Retention erases `declineReason` with the booking's other personal data (Free, only if it fits the 190 B left; else record)
- [x] Meets the Definition of Done (Pro repo `pnpm verify` too)

## Notes

- Decision recorded as BUILD-PLAN **R98**. Pro code: `emdash-plugins-pro` branch `pro-agent-abb30b24cca4196fd`
  (worktree `/Users/semics/code/semics/.pro-worktrees/agent-abb30b24cca4196fd`, whose `node_modules` links point at this
  public worktree while unlanded: run `pnpm install` in the Pro repo after landing). Files: `src/payments/holds.ts`,
  `stripe-holds.ts`, `hold-settle.ts`, `approve.ts`, `pay-now-mail.ts`; changes in `stripe.ts`, `stripe-events.ts`,
  `provider.ts`, `webhook.ts`, `refunds.ts`, `sweep.ts`, `reconcile.ts`, `plugin.ts`, `pro.json` (`authoriseWithinDays`).
- Deviation (refinement): the mode is chosen by the approval **deadline** (`approval.until`, already never later than the
  date's start), not by the start. It is when the charge happens at the latest, is on the booking (no config read in
  checkout), and keeps every request whose decision is due within 6 days on a plain authorisation. Hence the manual-capture
  deadline cap (authorisation + 6 d 18 h) never binds with the 6-day window; it is implemented anyway.
- Free seam (test-first, +59 B, backend 124.9 KiB, 131 B left): `approveBooking` refuses a booking with `payment`
  (`PAYMENT_FAILED`) so Free never confirms a held request unpaid (downgrade safety); retention erases `declineReason`.
  Pro approves held bookings in its own wrapper of `bookings.approve` (no further Free seam).
- "Pro Stripe confirm calls `settle`": held sessions settle through Free's `settle` into `awaiting_approval`; a normal paid
  session (no approval, or an approved "Pay now") takes its outbox rows from `settle` too, so `notifyAdminOn: all` now also
  tells admins of paid bookings. Sessions of approval bookings are always hold sessions, so a normal session never needs
  approval; a hold-less session created by T131-era code would still be confirmed without waiting (no release had both).
- Pre-existing Pro failure fixed: `pro.build.test.ts` checked the Free Events backend against R51's 116 KiB since T129 (R94
  gave Events 125 KiB); the Pro build suite now takes `freeBackendBudget` and events-pro passes `EVENTS_BUNDLE_BUDGET`.
- Follow-up (not in scope): "Pay now" goes through Free's `public/checkout/continue`, which re-plans a non-waiver booking's
  attendees in the buyer's name (existing T077 resume behaviour), so names typed at checkout are lost on that path.
- Decline racing an approve's capture refunds it; the record is closed by the sweep's one-shot (no call left in the decline).
