---
id: T049
title: "Events: booking status and self-service cancel"
phase: 2
package: events
edition: free
status: review
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

- [x] Wrong token returns 404-equivalent without timing difference
- [x] Cancel inside policy frees seats
- [x] Cancel outside policy is refused

## Implementation (green, then refactor)

- `src/routes/booking.ts`

## Acceptance criteria

- [x] Within budget
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- Cancellation policy: the plan names none, so I added the `cancelCutoffHours` setting (default 24, 0 to 720,
  in `emdash-plugin.jsonc`). Start time = the booked occurrence's `startsAt` from the event config catalog, else
  the config's `salesEnd` for events without occurrences, else cancel stays open. Held / awaiting bookings can
  always be abandoned (no config or settings reads). Refunding a paid confirmed booking is not done here.
- New shared error code `CANCEL_NOT_ALLOWED` (409), added as its own line in `packages/shared/src/result.ts`
  right after `BOOKING_TOKEN_EXPIRED` (events section), clear of T112's `SESSION_REQUIRED`.
- Bridge calls: confirmed cancel = query, config get, settings list, claim, release x counters, move, outbox
  = 6 + counters. One ticket type, no occurrence: 8. With an occurrence: 9. Largest order is capped at 10 by
  releasing event and occurrence counters first; the rest is left to the sweeper's drift repair.
- Attendee docs are not marked cancelled (that would cost one write each); check-in (later) must refuse
  attendees whose booking is not `confirmed`.
- Unknown refs run `verifyToken` against a decoy hash so they cost the same as a wrong token.
- Budget tests use the fake-storage `meter` (as T048), not workerd `withBudget`.
