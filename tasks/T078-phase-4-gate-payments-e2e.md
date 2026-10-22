---
id: T078
title: "Phase 4 gate: payments E2E"
phase: 4
package: events
edition: pro
status: in-progress
model: opus-5.5
size: S
depends_on: [T074, T075, T076, T077, T072, T071]
spec: [Phase 4 exit]
---

# T078 · Phase 4 gate: payments E2E

## Definition

End-to-end paid booking with Stripe test mode (local fakes now, real test mode once keys exist), expired session releasing holds, webhook replay; review recorded.

## Model

**Opus 5.5**: Money-path review.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Paid journey passes
- [ ] Expired session releases holds
- [ ] Replay idempotent

## Implementation (green, then refactor)

- `apps/playground/e2e/payments.spec.ts`, `tasks/reviews/phase-4.md`

## Acceptance criteria

- [ ] No open Severity 1 or 2
- [ ] From T077: Pro returns `next: { type: "pay" }` for a waiver booking at `awaiting_payment` with signed attendees, also on a repeated continue, so "Pay now" works; prove the real Pro pay step with the Pro edition host end to end
- [ ] The booking widget sends `promoCode` and can call `public/promo/check` to reveal hidden ticket types (T076: Pro routes exist, the Free UI does not use them yet); a promo-code order through the real Pro reserve and Stripe step is part of the payments E2E
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```
