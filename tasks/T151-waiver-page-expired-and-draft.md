---
id: T151
title: "Waiver page: expired bookings say so; slot line survives a draft or paused event"
phase: 7
package: events-suite
edition: free
status: review
model: opus-5.5
size: S
depends_on: [T148]
spec: []
---

# T151 · Waiver page for expired bookings and draft events

## Definition

From LMSC staging after T148 (booking `1AW8BTXB3T`, clay slot event):

1. The booking's hold ended (status `expired`), yet `/_events/waiver?ref=…` still renders the
   disclaimer and the signing form. An expired (or cancelled) booking should show "This booking has
   expired. Please book again." with a link to the event, and no signing form. Check the server side
   too: signing an expired booking must be refused (if it already is, add the test that proves it).
2. With the event's sales status moved to draft or paused, the T148 slot line disappears, title
   included, because `public/event` answers nothing for a draft event. A booking made while on sale
   should keep its title and date. Prefer data `public/booking` already returns (or can return
   cheaply) for the booking's own occurrence; the Events bundle has about 24 bytes of hotfix room
   (bundle-size test), so any Events change must trim an equal amount and say what.

## Acceptance criteria

- [x] A test fails today: an expired booking's waiver page shows the expired message and no form.
- [x] Signing an expired booking is refused server-side (test proves it).
- [x] A test fails today: a booking on a draft or paused event still shows its title and date.
- [x] Bundle-size test passes; any Events trim named in the report.

## Notes

- Server side: e-sign knows nothing of bookings, so the refusal sits in two places. (1) The suite page
  (`lib/flow.ts` `sign`) reads `public/booking` with its access cookie before any ceremony GET or post; an
  expired/cancelled/declined/refunded booking, or a hold past `holdExpiresAt`, is `BOOKING_EXPIRED` and e-sign is
  never asked, so no signature is captured. (2) Events `signatures/receipt` already confirms nothing for an
  `expired` booking (status stays, nothing sold or queued): new test in `tests/routes/receipt.test.ts`. A direct
  call to e-sign with a token lifted from the HttpOnly cookie could still sign the envelope; Events ignores it.
  When `public/booking` cannot be read (no cookie, Events down), signing goes on as before.
- Draft/paused: `public/booking` now carries `event` (the config's `info`, `startsAt` = the booked occurrence's
  from the catalog). It reuses the confirmed booking's config read; held bookings gain one read (3 calls).
  Paused events already answered `public/event`; draft ones did not.
- Bundle (R100): +159 B for `event`, trimmed 239 B: `keyOf` shared for counter keys (`holds.ts`, `cron/waitlist.ts`),
  `text()` for the Turnstile site key (`public-events.ts`), `str()` for admin entry titles (`admin/pages.ts`).
  Backend 123,889 B -> 123,809 B (95 B of hotfix room, was 15).
- "Book again" links to `/events/<slug>` (Events' `eventHref`); without a slug only "Back to your booking" shows.
- No e2e spec was written or run (unit tests cover the flow; the playground belongs to T149/T150).
