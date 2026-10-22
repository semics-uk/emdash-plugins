---
id: T050
title: "Events: confirmation email and calendar routes"
phase: 2
package: events
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T048, T015, T018]
spec: [EV-US-3, EV-FR-08, EV-FR-09]
---

# T050 · Events: confirmation email and calendar routes

## Definition

Confirmation email with links, and `public/booking/ics` / `public/event/ics` raw `text/calendar` behind signed links.

## Model

**Sonnet 5.5**: Wiring existing modules.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Email contains booking, ticket and ICS links and no attachment
- [x] ICS route returns valid calendar with correct TZID
- [x] Expired signed link fails

## Implementation (green, then refactor)

- `src/emails/confirmation.ts`, `src/routes/ics.ts`

## Acceptance criteria

- [x] Snapshots in 3 zones
- [x] Emails go through the shared outbox (T015): declare `OUTBOX_COLLECTION`, adapt `ctx.storage.outbox` to `OutboxStorage`, `drainOutbox` from the cron tick; delivery is at-least-once
- [x] The queued `confirm-<bookingId>` row holds only `{ bookingId, bookingRef }` (T048): render at send time, read attendees then, issue a fresh access token for the emailed link (store only its hash); reconcile the schema `OutboxDoc` (`kind` + `payload`, string `nextAttemptAt`) with the shared `OutboxRecord`/`OutboxStorage`
- [x] Sends the `booking_cancelled` outbox kind (T049) as well as confirmations
- [x] `public/booking` returns `calendar: { query }` signed with `signLink` (purpose `events/booking-ics`, ~15 min) and each attendee's check-in code to the token holder (R33), so the booking page shows passes (T055)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **Outbox reconciliation.** Rows stay `OutboxDoc` (ids only, ISO `nextAttemptAt`, new optional `lastError`/`sentAt`). `src/emails/outbox.ts` adapts them to the shared `OutboxStorage`: `query` returns `OutboxRecord`s whose `message` is a stub, and the `email.send` handed to `drainOutbox` looks the row up from the stub, renders the real message from fresh reads and sends it. `putMany` maps the result back to `OutboxDoc`. No shared file was edited; because no message body is stored, T113's scrub of sent mail changes nothing here.
- **Throughput.** One message per tick (`OUTBOX_PER_TICK = 1`): a confirmation costs query + booking + attendees + setting + entry + code write + send + putMany = 8 bridge calls (9 for a recurring event); a cancellation 6 or 7; an empty tick 1. That is one email a minute. If a launch needs more, cache the event entry on the config (a later task) to fit a second message.
- **Booking link design (R34).** The access token is never emailed. Each confirmation mints a one-time code, stores only `hashToken(code)` and an expiry (7 days) on the booking (`redeemHash`, `redeemExpiresAt`), and emails `/booking?ref=<ref>&k=<code>`. New public route `public/booking/redeem` (POST `{ bookingRef, code }`, 2 bridge calls) checks the code in constant time, swaps in a fresh access token (replacing `accessTokenHash`), clears the code and returns the token for T053's HttpOnly cookie. Wrong code, unknown ref, expired and replayed codes are all `NOT_FOUND`. The code is only a URL value until its first use; it never reaches the outbox, logs or the cookie. A crash-retry of the send mints a newer code (the earlier link stops working). This adds a public route (documented in BUILD-PLAN 3.1 and R34).
- **Follow-up for T053/T055.** `BookingPage` must handle `?k=`: show an "Open my booking" button (a form POST), not exchange on GET, so mail-scanner prefetches cannot burn the code; then call `public/booking/redeem` server-side, set the `semics_booking_<ref>` cookie from the returned token and redirect to `/booking?ref=<ref>` without `k`.
- Event name, start, end, timezone and venue come from the content entry (`title`, `starts_at`, `ends_at`, `timezone`, `venue`) in the `eventsCollection` setting; an occurrence's start overrides it. Email times are built from zone parts ("Sat 14 Nov 2026, 14:00 UTC-5 (America/New_York)"), not `Intl` zone names, which differ between workerd and Node.
- The T049 test that asserted attendee codes were withheld was updated: R33 now returns each valid attendee's code to the token holder.
