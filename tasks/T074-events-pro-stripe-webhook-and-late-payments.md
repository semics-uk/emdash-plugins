---
id: T074
title: "Events Pro: Stripe webhook and late payments"
phase: 4
package: events
edition: pro
status: backlog
model: opus-5.5
size: M
depends_on: [T073]
spec: [EV-FR-13, EV-NFR-05, R2]
---

# T074 · Events Pro: Stripe webhook and late payments

## Definition

`webhooks/stripe` verifies signatures with timestamp tolerance, writes `payments` documents idempotently, confirms bookings, and re-reserves or auto-refunds late payments.

## Model

**Opus 5.5**: Money correctness.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Replay of the same event changes nothing
- [ ] Bad signature and stale timestamp rejected
- [ ] Late payment re-reserves when seats remain, refunds when sold out
- [ ] Within budget

## Implementation (green, then refactor)

- `src/routes/stripe-webhook.ts`

## Acceptance criteria

- [ ] Raw body verification
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
