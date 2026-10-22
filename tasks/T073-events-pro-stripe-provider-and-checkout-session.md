---
id: T073
title: "Events Pro: Stripe provider and checkout session"
phase: 4
package: events
edition: pro
status: in-progress
model: opus-5.5
size: M
depends_on: [T071, T048, T118]
spec: [EV-FR-13, R1]
---

# T073 · Events Pro: Stripe provider and checkout session

## Definition

`PaymentProvider` interface and Stripe implementation: create Checkout Sessions with `expires_at ≥ 30 min`, extend the hold to match, return the redirect.

## Model

**Opus 5.5**: External API with timing rules.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Session request body matches Stripe's API (faked with `host.http.respond`)
- [ ] `expires_at` never under 30 minutes
- [ ] One outbound call per request
- [ ] Within budget

## Implementation (green, then refactor)

- `src/payments/provider.ts`, `src/payments/stripe.ts`

## Acceptance criteria

- [ ] Pro build only
- [ ] On webhook confirmation: count `sold` (`confirmSold`), flip `pending` attendees to `valid`, queue `confirm-<bookingId>`; plug in through `PaymentStep` (T048)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
