---
id: T049
title: "Events: booking status and self-service cancel"
phase: 2
package: events
edition: free
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T048]
spec: [EV-US-4, Events public routes]
---

# T049 · Events: booking status and self-service cancel

## Definition

`public/booking` and `public/booking/cancel` with the token in the POST body; cancel releases inventory within policy.

## Model

**Sonnet 5.5**: Straightforward routes.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Wrong token returns 404-equivalent without timing difference
- [ ] Cancel inside policy frees seats
- [ ] Cancel outside policy is refused

## Implementation (green, then refactor)

- `src/routes/booking.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
