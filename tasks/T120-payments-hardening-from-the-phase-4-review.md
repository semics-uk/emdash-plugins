---
id: T120
title: "Payments: hardening from the Phase 4 review"
phase: 6
package: events
edition: pro
status: in-progress
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

- [ ] (F4) A paid session whose `amount_total` or currency differs from the `stripe:<sessionId>` record (or, on the adopt path, from the booking's totals) does not confirm the booking: it is refunded (or held for the owner) and logged
- [ ] (F5) A `stripe:<sessionId>` record still `pending` well after its session expired (the webhook was never delivered: endpoint misconfigured, or a site ran Free for longer than Stripe's three days of retries) is reconciled from Stripe's session status by a sweep step (one `GET /v1/checkout/sessions/<id>` per record per tick, within budget), then settled as the webhook would
- [ ] (F6) A late payment (R2) that re-confirms a booking with a promo code whose use the repair already gave back does not take the code over `maxUses` (re-redeem with the guard, or accept and document)
- [ ] (F10) `public/promo/check` refuses a draft event (`status: "draft"`) like `public/event`, so a code never reveals a draft event's hidden type names
- [ ] (F11) A reserve with a code on a site whose licence lapsed tells the buyer the code cannot be used (the widget maps the licence codes to a promo message instead of "Something went wrong")
- [ ] (F13) Refunds of one session with different reasons never reuse the idempotency key with different parameters (Stripe answers 400 to that); a refund retried after Stripe's 24-hour key expiry that finds the charge already refunded closes the ledger instead of retrying until the warning

## Implementation (green, then refactor)

- Pro: `src/payments/{webhook,sweep,stripe,refunds}.ts`, `src/promo/{check,reserve}.ts`
- Free: `packages/events/src/astro/lib/widget.ts` (messages)

## Acceptance criteria

- [ ] Every test above passes; budgets asserted (≤ 10 bridge calls, target 8)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
```
