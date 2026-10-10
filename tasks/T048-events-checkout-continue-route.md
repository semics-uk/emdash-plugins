---
id: T048
title: "Events: checkout continue route"
phase: 2
package: events
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T047]
spec: [EV-FR-05, EV-FR-07]
---

# T048 · Events: checkout continue route

## Definition

`public/checkout/continue`: write attendees, issue the access token, queue confirmation, return the next step; idempotent.

## Model

**Opus 5.5**: Idempotent state transitions.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Free booking reaches confirmed
- [ ] Replaying continue changes nothing
- [ ] Expired hold returns `HOLD_EXPIRED`
- [ ] Budget assertion ≤ 10 calls

## Implementation (green, then refactor)

- `src/routes/checkout-continue.ts`, `src/domain/booking-state.ts`

## Acceptance criteria

- [ ] State machine shared with later phases
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
