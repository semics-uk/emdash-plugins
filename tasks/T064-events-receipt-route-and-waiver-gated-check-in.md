---
id: T064
title: "Events: receipt route and waiver-gated check-in"
phase: 3
package: events
edition: pro
status: backlog
model: opus-5.5
size: M
depends_on: [T063, T071]
spec: [EV-FR-12, SX-FR-04]
---

# T064 · Events: receipt route and waiver-gated check-in

## Definition

`signatures/receipt` verifies and records receipts, advances bookings, and check-in refuses attendees whose waiver is pending.

## Model

**Opus 5.5**: Protocol verification with state changes.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Valid receipt confirms the booking
- [ ] Forged or replayed receipt rejected
- [ ] Pending attendee refused at check-in with the signing link
- [ ] Idempotent on repeat

## Implementation (green, then refactor)

- `src/routes/receipt.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Check-in refuses attendees whose booking is not `confirmed` (T049 does not mark attendee docs on cancel)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
