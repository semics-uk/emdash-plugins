---
id: T075
title: "Events Pro: refunds"
phase: 4
package: events
edition: pro
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T074, T071]
spec: [EV-US-4]
---

# T075 · Events Pro: refunds

## Definition

Admin refund action and buyer cancel refunds through Stripe; inventory released; refund email.

## Model

**Sonnet 5.5**: Builds on T074.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Refund calls Stripe once and marks refunded
- [ ] Partial failures leave a retryable state

## Implementation (green, then refactor)

- `src/payments/refunds.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Self-service cancel of a paid confirmed booking (T049 `public/booking/cancel`) issues the refund per policy, or is refused until the refund step exists; never cancel a paid booking without refunding
- [ ] From T074: email buyers about refunds (including R2 `refunded_unavailable` and duplicate-payment refunds) through the outbox; a paged sweep settles `paid` payment records whose one-shot never ran
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
