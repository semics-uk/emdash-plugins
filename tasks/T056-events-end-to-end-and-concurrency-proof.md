---
id: T056
title: "Events: end-to-end and concurrency proof"
phase: 2
package: events
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T050, T051, T052, T054, T055, T009]
spec: [Phase 2 exit criteria]
---

# T056 · Events: end-to-end and concurrency proof

## Definition

Playwright free-booking journey plus a load test of 100 concurrent checkouts for the last 5 seats against the playground.

## Model

**Opus 5.5**: Concurrency proof needs careful harness design.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Journey: list → book → email (captured) → ICS → cancel
- [ ] Load test: exactly 5 bookings succeed, 95 get `SOLD_OUT`
- [ ] ICS and email times correct in 3 zones

## Implementation (green, then refactor)

- `apps/playground/e2e/events.spec.ts`, `apps/playground/load/checkout.mjs`

## Acceptance criteria

- [ ] Runs in CI
- [ ] Booking page handles `?k=` (T050, R34): show an "Open my booking" button that POSTs, call `public/booking/redeem` server-side, set the `semics_booking_<ref>` cookie, redirect to `/booking?ref=` without `k`; never redeem on GET (mail scanners prefetch). Wire `calendar.query` and attendee `code` from `public/booking` into the pass and calendar link (T055)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```
