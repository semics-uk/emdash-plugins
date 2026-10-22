---
id: T075
title: "Events Pro: refunds"
phase: 4
package: events
edition: pro
status: review
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

- [x] Refund calls Stripe once and marks refunded
- [x] Partial failures leave a retryable state

## Implementation (green, then refactor)

- `src/payments/refunds.ts`

## Acceptance criteria

- [x] Within budget
- [x] Self-service cancel of a paid confirmed booking (T049 `public/booking/cancel`) issues the refund per policy, or is refused until the refund step exists; never cancel a paid booking without refunding
- [x] From T074: email buyers about refunds (including R2 `refunded_unavailable` and duplicate-payment refunds) through the outbox; a paged sweep settles `paid` payment records whose one-shot never ran
- [x] Meets the Definition of Done in `tasks/README.md`

## Notes

- Pro repo, branch `pro-agent-t075`: `src/payments/refunds.ts` (cancel step, admin full refund), `refund-mail.ts`, `sweep.ts`; the webhook queues refund emails and stores the payment intent on the booking.
- Small public seams (Free): `RefundStep`/`bookingCancelRoute` on `public/booking/cancel` (Free refuses to cancel a paid confirmed booking), edition renderers for outbox kinds, `SCHEDULES_FLAG` bumped to v4 for `stripe-sweep`.
- Paid cancel is 10 calls (hard limit), not the 8 target: event and occurrence counters are released first; ticket-type counters may be left to drift repair for dated events.
- Partial refunds not done (the task asks for full only).
- Pro tests need the Pro `link:` to resolve to a checkout containing these public commits (land public first).

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
