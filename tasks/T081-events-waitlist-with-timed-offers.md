---
id: T081
title: "Events: waitlist with timed offers"
phase: 5
package: events
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T057]
spec: [EV-FR-16, EV-US-6]
---

# T081 · Events: waitlist with timed offers

## Definition

Join when sold out; freed seats trigger offers with a 24-hour claim link; unclaimed offers pass on; claim reserves inventory.

## Model

**Opus 5.5**: Concurrency with inventory.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Freed seat offers to the earliest entry
- [x] Expired offer moves to the next
- [x] Two claims for one seat: one wins
- [x] Cron batches within budget

## Implementation (green, then refactor)

- `src/domain/waitlist.ts`, `src/cron/waitlist.ts`

## Acceptance criteria

- [x] Emails via outbox
- [x] Waitlist rows that hold an email get an `email` index and are covered by the T087 retention job and the admin "Delete personal data" action
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- Design: an offer is an ordinary `held` booking in the waitlister's name (`waitlistId` on the booking, `bookingId` on the
  entry), reserved through the checkout `reserve` guards, so an offer, a checkout and an overlapping tick racing for one
  seat cannot all win (tests: two parallel ticks, two parallel claims of one code). The hold is 24 h (`OFFER_HOURS`) with
  the ceiling 60 min beyond, so a late claim can still pay (Pro's Stripe `expires_at` stays within 24 h). No calls were
  added to cancel/expiry/refund: the every-minute `waitlist` cron compares availability (configs query: exact event
  counter; then the waiting entries of events with room, join order). A ticket type's or date's counter is read only when
  `config.reserved + qty` exceeds its capacity (their `reserved` can never exceed the event's), so no dead bookings are
  made for a type without room. Budget per tick: idle 1, offer <= 8 without dates, 9-10 with dates; every 5th minute a
  tick without an offer marks lapsed `offered` entries `expired` (the sweeper has already released their seats).
- Claim: the outbox `waitlist_offer` row holds ids only; the drain mints the one-time code (hash on the booking, valid as
  long as the offer) and links `/booking?ref=&k=&offer=1`. The page shows "Claim my tickets" (GET redeems nothing); its
  POST calls `public/waitlist/claim` (`redeemBooking(..., { claim: true })`: held offers only, guarded on the hold; entry ->
  `claimed`; 3 calls), sets the cookie and continues the booking like "Pay now" (free: confirmed + confirmation email).
  The plain redeem of an offer also marks the entry claimed.
- Join: strict body (`parseJoinInput`), `planCheckout` refuses dates/types/quantities an offer could never fill, Turnstile
  when a secret is set, shared KV `rateLimit` (5 per 10 min per IP, salted), one live entry per email+event+date (a
  concurrent double join can make two entries: harmless). Answer is `{ ok: true }` either way. 7 calls (6 without
  Turnstile). No "you joined" email (would let anyone mail an address; only the offer is emailed).
- Retention: phase 4 `waitlist` deletes entries that joined longer ago than the period (oldest first, default storage
  order, no index). Admin deletion by email also deletes the person's entries (new `email` index; preview counts them; one
  attendee page less when entries go too, so <= 10 calls). Manifest change: `waitlist` gains the `email` index.
- UI: `public/event` answers `waitlist: true`; the widget shows a "Join the waitlist" form (date select for sold-out dates,
  "Any ticket"/type select, qty 1-10, name, email, Turnstile) when tickets or a date are sold out; it posts to the injected
  `/_events/waitlist` (Origin check, `handleWaitlistRequest`), which redirects back with `?waitlist=<outcome>` only.
- Schedules flag `cron:scheduled:v9` (shared). `packages/esign/tests/self-schedule.test.ts` asserts the version, so its
  one line was updated (no other E-sign change). Pro: the Events Pro `ensure-schedules` tick now makes 9 calls (Pro's 4
  piggybacked schedules + Free's 4 + the flag): within 10, over the target of 8. The next recurring task on either side
  should batch.
- Bundle (R47): `dist/plugin.mjs` 107.0 -> 111.6 KiB (budget 112). To fit, the three booking emails share one composer
  and reserve/join share `botCheck` and `httpFetch` (no behaviour change). Only 0.4 KiB is left: the next Free Events
  feature needs trimming first.
- Not done (follow-ups): the BUILD-PLAN's admin "Waitlist" page; the shared `rateLimit` KV keys (`rl:waitlist:<hash>:<window>`)
  are never deleted (KV has no TTL; E-sign's limiter has the same debt) and should be swept by retention.
