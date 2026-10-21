---
id: T048
title: "Events: checkout continue route"
phase: 2
package: events
edition: free
status: done
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

- [x] Free booking reaches confirmed
- [x] Replaying continue changes nothing
- [x] Expired hold returns `HOLD_EXPIRED`
- [x] Budget assertion ≤ 10 calls

## Implementation (green, then refactor)

- `src/routes/checkout-continue.ts`, `src/domain/booking-state.ts`

## Acceptance criteria

- [x] State machine shared with later phases
- [x] Schedules or re-arms the `hold-<ref>` one-shot (T047 reserve skips it when Turnstile is configured, to stay within 8 calls); every booking write guards on status + `releaseClaimedAt: null`
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **Auth and lookup.** The body is `{ bookingRef, accessToken, attendees? }`; the booking is found
  with one `bookings.query` on the unique `ref` and the token checked with `verifyToken`. A wrong
  token answers `NOT_FOUND`, exactly like an unknown ref. No per-IP rate limit: the 256-bit token
  is the credential and nothing is written without it (same reasoning as R29); a limiter would cost
  KV calls in a route that confirms in up to 9.
- **"Issue the access token".** T047 already issues it in the reserve response; continue requires
  it. The queued confirmation (`outbox` id `confirm-<bookingId>`, kind `booking_confirmed`, the
  schema's `OutboxDoc` shape) carries only `{ bookingId, bookingRef }`: no token or ticket code is
  ever stored in plain text. **T050** must therefore render the email at send time, read the
  attendees then, and decide how the emailed link authenticates (for example issue a fresh token at
  send time and store only its hash). T050 also has to adapt this `OutboxDoc` shape (string
  `nextAttemptAt`, `kind` + `payload`) to the shared `OutboxStorage`/`OutboxRecord`, which differ.
- **Order and idempotency.** Confirm (`updateIf` guarded on status + `holdExpiresAt` +
  `releaseClaimedAt: null`) → `confirmSold` → `attendees.putMany` → `outbox.put`. The outbox row
  is the marker: a replay of a confirmed booking with it present writes nothing (2 calls); without
  it (the confirming invocation died) the replay writes attendees + outbox but never re-counts the
  sale. A lost `confirmSold` leaves `sold` low, which drift repair recomputes from confirmed
  bookings (an event is only repaired when the sweeper next visits it; no dirty mark, to stay in
  budget). A confirm `updateIf` miss re-reads: confirmed by a concurrent continue → done; else
  `HOLD_EXPIRED`. Attendee ids are `<bookingId>-<n>`, so rewriting replaces; check-in codes are
  fresh 256-bit tokens (only ever rewritten before the confirmation is queued).
- **Budget.** Free confirm: 1 + 1 + counters + 2, i.e. 5 for one ticket type (target 8 asserted),
  9 for the largest order reserve accepts (≤ 5 counters; asserted with fakes). `confirmSold` is
  capped at 6 counters.
- **Paid / sign steps.** Paid checkout is Pro. The route takes an optional `PaymentStep` seam:
  absent in Free, so a paid booking gets `PAYMENT_FAILED` and is untouched. With a provider (tested
  with a fake), the step reads settings, extends the hold with `extendHold`/`stepTarget` (60-min
  ceiling) while moving to `awaiting_payment` in the same guarded write, writes `pending`
  attendees, and **re-arms `hold-<ref>`** at the new expiry. The free confirm path does not schedule
  the one-shot (the booking leaves the hold). `sign` exists in the state machine; Free never has a
  signature pending. The Pro payment task must flip attendees to `valid`, count `sold` and queue
  the confirmation when its webhook confirms.
- A `draft` booking (reserve still running) answers `INTERNAL` (retry). Expired, cancelled or
  refunded bookings answer `HOLD_EXPIRED`.
- `BookingDoc` gains an optional `confirmedAt`. `tests/domain/fake-storage.ts` gains `put`/`putMany`
  and `attendees`/`outbox` collections.

