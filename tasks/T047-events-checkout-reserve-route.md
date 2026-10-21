---
id: T047
title: "Events: checkout reserve route"
phase: 2
package: events
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T044, T045, T013]
spec: [EV-FR-05, R9]
---

# T047 · Events: checkout reserve route

## Definition

`public/checkout/reserve`: Turnstile, rate limit, validation, reservation and booking creation in ≤ 10 calls.

## Model

**Opus 5.5**: Budget-constrained critical path.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Valid request returns a booking ref and hold expiry
- [ ] Sold out, bad Turnstile and rate limit each return their code
- [ ] Budget assertion ≤ 10 calls
- [ ] Duplicate submit with the same idempotency key returns the same booking

## Implementation (green, then refactor)

- `src/routes/checkout-reserve.ts`

## Acceptance criteria

- [ ] Inputs validated with zod
- [ ] Budget (T044): reads + worst-case reserve leave room for only 3 inventory steps under 8 calls, and the route also needs a booking put, a rate-limit KV call and Turnstile. Denormalise reads or leave compensation to the sweeper (an over-count is safe); pass the remaining budget as `maxCalls`. Write the booking as `draft` before `reserve`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
