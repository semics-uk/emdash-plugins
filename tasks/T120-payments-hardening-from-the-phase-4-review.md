---
id: T120
title: "Payments: hardening from the Phase 4 review"
phase: 6
package: events
edition: pro
status: review
model: opus-5.5
size: S
depends_on: [T078]
spec: [EV-FR-13, EV-FR-14, R2]
---

# T120 · Payments: hardening from the Phase 4 review

## Definition

The Severity 3 and 4 findings of the Phase 4 gate review (`tasks/reviews/phase-4.md`) that no other task
owns. None is exploitable by a buyer today. Most are Pro (`packages/events-pro/src/payments`, `src/promo`
in the Pro repo); the widget messages are Free UI.

## Model

**Opus 5.5**: Money paths, each inside the 10-call budget.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] (F4) A paid session whose `amount_total` or currency differs from the `stripe:<sessionId>` record (or, on the adopt path, from the booking's totals) does not confirm the booking: it is refunded (or held for the owner) and logged
- [x] (F5) A `stripe:<sessionId>` record still `pending` well after its session expired (the webhook was never delivered: endpoint misconfigured, or a site ran Free for longer than Stripe's three days of retries) is reconciled from Stripe's session status by a sweep step (one `GET /v1/checkout/sessions/<id>` per record per tick, within budget), then settled as the webhook would
- [x] (F6) A late payment (R2) that re-confirms a booking with a promo code whose use the repair already gave back does not take the code over `maxUses` (re-redeem with the guard, or accept and document)
- [x] (F10) `public/promo/check` refuses a draft event (`status: "draft"`) like `public/event`, so a code never reveals a draft event's hidden type names
- [x] (F11) A reserve with a code on a site whose licence lapsed tells the buyer the code cannot be used (the widget maps the licence codes to a promo message instead of "Something went wrong")
- [x] (F13) Refunds of one session with different reasons never reuse the idempotency key with different parameters (Stripe answers 400 to that); a refund retried after Stripe's 24-hour key expiry that finds the charge already refunded closes the ledger instead of retrying until the warning

## Implementation (green, then refactor)

- Pro: `src/payments/{webhook,sweep,stripe,refunds}.ts`, `src/promo/{check,reserve}.ts`
- Free: `packages/events/src/astro/lib/widget.ts` (messages)

## Acceptance criteria

- [x] Every test above passes; budgets asserted (≤ 10 bridge calls, target 8)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
```

## Notes

- Finding numbers: this file's F11 (licence message) and F13 (refund keys) are the review's F9 and F11.
- **F4 (R49, new decision row):** the paid `amount_total`/`currency` is compared with the `stripe:<sessionId>`
  record (the booking's totals after the promo; the adopt path writes them from the booking). A mismatch,
  including a missing amount or currency, is refunded automatically (`amount_mismatch`) and logged; never
  confirmed, no refund email (it would name the booking's total). Webhook path ≤ 7 calls.
- **F5:** Pro `src/payments/reconcile.ts`, recurring `stripe-reconcile` (every 10 min), scheduled by Pro on
  `ensure-schedules` like `stripe-sweep` (Free's `RECURRING_TASKS` does not know Pro tasks, per the Pro README), so
  the public change is only the flag bump to `cron:scheduled:v7` (shared `schedules.ts`; the E-sign self-schedule
  test pins it). A record `pending` an hour after its session expired gets one `GET /v1/checkout/sessions/<id>`;
  paid → the webhook's guarded `paid` write, then the settle one-shot (or, when the tick has no room, the settle
  sweep 10 minutes later); expired → `expired`. ≤ 8 calls per tick (asserted), 1-2 records a tick, idle tick 2.
- **F6:** re-redeem with the guard, in the late-payment path: when the booking has a `promoCode`, the code has a
  limit, and the promo repair recounted after the booking's `expiredAt`, the use is taken again with the reserve's
  guarded increment; a miss refunds as `unavailable`. A retry carries `redeemed` in the one-shot data so the use
  is never taken twice (a one-shot rescheduled by the settle sweep loses it: accepted, the repair recounts).
- **F9 (this file's F11):** Free UI only (`widget.ts` `promoRefusal`, `PROMO_UNAVAILABLE`): a `LICENCE_*` refusal
  of a reserve with a code, or of `/_events/promo`, shows "That code can't be used right now." on the promo field.
  Not in the backend bundle (R47 untouched).
- **F11 (this file's F13):** key `refund-<sessionId>-<reason>` (`requested` shares `cancelled`'s, as before); a 400
  `charge_already_refunded` is a refund with no id (ledger `refundId: null`, `refundedMinor` = paid amount). Paid
  cancel stays at 10 calls (no call added).
- Pro tests use the public worktree through repointed `node_modules` links in the Pro worktree; run `pnpm install`
  in the Pro repo after landing (ORCHESTRATOR "Pro tasks").
