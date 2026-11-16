---
id: T174
title: "Booking requests with a time to be agreed: gaps from lmsc-site #59"
phase: 8
package: events, events-pro, events-suite
edition: free, pro
status: backlog
model: opus-5.5
size: L
depends_on: []
spec: []
---

# T174 · Booking requests with a time to be agreed (backlog)

Reported 2026-11-15 by the lmsc-site #59 session (multi-step activity booking request page), checked against rc.16.
For now the site sends #59 through the Forms plugin as a booking request with a reference number. It takes no
payment and stays behind `ONLINE_BOOKING`. Nothing here blocks the site. This file is the list to plan from.

## Gaps

1. **Preferred date and time window.** The customer picks a date and a window (for example AM 10:00–12:00, PM
   12:00–15:30) instead of a fixed occurrence or slot. The booking is pending with the time to be agreed. Today a
   booking needs a specific occurrence or slot.
2. **Staff confirm or propose a time.** Today staff can only Approve, or Decline with a reason. Needed: move a
   booking to another occurrence or time, and a flow where the customer accepts the time staff propose.
3. **Refund when no time is agreed.** Already covered: Decline releases the card hold or refunds in full (Pro).
   Only full refunds.
4. **Packages in one booking.** Packages priced per party (1, 2, up to 5 people) or per person (minimum 5).
   Ticket types already have `minPerOrder` and `maxPerOrder` (`storage/schema.ts`), so packages can already be
   ticket types. Missing: an add-on line priced per person (for example quad trekking at £54 a person) whose
   quantity is capped by the party size.
5. **Attendees later.** Names and emails optional at booking, with the waiver links sent after staff approve.
   Today there is one waiver per seat, tied to the booking.
6. **Schedules by weekday or alternate week.** Already known (LMSC's `src/lib/opening-hours.ts`).

## Notes

- **Payment (decided, lmsc-site#59, 2026-11-16):** charge in full at request time, not a card hold; the booking stays pending until staff confirm a time; Decline, or no time agreed, refunds in full through the existing Pro refund. So the 7-day hold expiry does not apply.
- 1 and 2 are the core feature ("request a time, staff confirm"). They overlap with Pro approval holds: the card
  hold expiry (about 7 days) limits how long a time can stay unagreed.
- Weigh Free Events bytes on any change (125 KiB budget, about 119 KB used). 1, 2 and 5 may fit better as Pro or
  suite features.

## Plan (2026-11-16)

No new booking status: a request is `awaiting_approval` with `booking.request = { date, window, proposed? }`; the
agreed time is `booking.time = { startsAt, endsAt? }` (not an occurrence). Event config `requests = { windows
[{id,label,start,end}], days, aheadDays, noticeDays, closedDates }` (request events have no schedule). Sub-tasks,
each its own rc, in priority order:

- **T174a · Request bookings and Confirm time (Free, widget; about +1.8 KB Free).** `request` in reserve
  (`domain/checkout.ts`, `routes/checkout-reserve.ts`), validated against `config.requests`; forces approval with
  the deadline at the earlier of `deadlineHours` and the window start (`approvalOf`). Panel "Booking requests" form.
  Approve on a request opens "Confirm time" (writes `time` with the confirm, `heldGuard`). Emails, ICS and booking
  page use `occurrence ?? time`; "time to be agreed" before that. Widget request mode (date picker and window radios).
- **T174b · Charge at request, refund on Decline or lapse (Pro, about +1.8 KB).** `requestPayment: charge | hold`
  (default charge) in `holdMode()`; Free approve refuses only a held payment; lapse refund via a settle one-shot at
  the deadline; `isSettled` treats a paid `awaiting_approval` as settled. Emails say "refunded in full".
- **T174c · Propose a time, customer accepts (Pro, Astro; about +2.8 KB).** `bookings.propose:<id>` writes
  `request.proposed` and moves the deadline (now + `proposalHours`, default 72); `time_proposed` email with a booking
  link; `public/booking/request/accept|refuse`; `BookingStatus.astro` shows Accept / "That doesn't work".
- **T174d · Per-person add-on (Free, about +0.8 KB).** `addon: true` ticket types: not seats, quantity capped by the
  order's seats, kept out of event and date capacity but keep their own counter.
- **T174e · Attendees after approval (Pro, about +1.2 KB).** Request bookings use `waiver.after`; the widget skips
  attendees; on confirm the buyer adds names on the booking page and invitations go then.

Risks: Pro settle and sweep never ran with a paid `awaiting_approval` booking (audit first); Stripe keeps its fee
on refunds (about 1.5% + 20p, tell LMSC); Free ends with about 1.9 KB left (fallback: move the T162 setup check
page); BST/GMT change for window starts (test the last Sunday in October).

## T174a notes (2026-11-16)

- **Shapes.** `config.requests` and `booking.request = { date, window }` as planned (`proposed?` left for T174c); the agreed
  time is `booking.time = { startsAt, endsAt? }`. `parseRequests` (`src/domain/schedule.ts`): 1–8 windows (id
  `[a-z0-9-]{1,32}`, label ≤ 40, `start < end`), 1–7 days, `aheadDays` 1–365 (default 90), `noticeDays` 0–365 (default 0).
  Refused (`INVALID_REQUESTS`) beside a schedule, an RRULE or dates.
- **Reserve.** Reasons `REQUEST_NOT_TAKEN` (no `requests`, or an `occurrenceId` with one), `REQUEST_REQUIRED`, `REQUEST_WINDOW`,
  `REQUEST_DATE` (weekday, notice, days ahead, closed date, or the window already started), issue path `request`. "Today"
  is the event zone's. `sameOrder` does not compare `request` (a reused idempotency key returns the first booking).
- **Deadline.** A request always gets `approval.until`: `deadlineHours` when set (even with approval off), else 48, capped
  at the window start (`wallMs`, DST like the schedule; tested across 25 Oct 2026).
- **Confirm time.** No modal in Block Kit, so Approve on a request (`bookings.time_ask`, value `{ id, d, s, z }`) shows a
  form on the Bookings page like Decline does; `bookings.confirm:<id>` carries the event's zone as the form's block id (no
  extra config read: approve stays at 9 calls). A plain `bookings.approve` of a request is `BAD_REQUEST`.
- **Readers.** `loadEventInfo(…, { time })` (emails, ICS), the booking page (`event.startsAt` = the time, or absent with
  `requested: "Sat 12 Dec, AM"`), and the cancel cutoff use `occurrence ?? time`. Emails before a time say "When: Sat 12 Dec,
  AM, time to be agreed" (`EventInfo.when`).
- **Widget.** Request mode is a `<select>` of the allowed dates (works without JS, so weekdays and closed dates are enforced
  without a script) plus window radios; the no-JS checkout posts `request` when the form has `needsRequest`.
- **For T174b (Pro).** Free's approve still refuses any booking with `payment` (`PAYMENT_FAILED`); a request charged at
  reserve needs Pro's approve wrapper to pass `time` through to `approveBooking(deps, id, time)` (the new third argument) and
  treat a paid (not held) request as approvable. The time form's action is `bookings.confirm:<id>` with the zone in `block_id`.
- **Bytes.** Free backend 119,392 → 122,978 B (+3,586, twice the plan's +1.8 KB); 926 B left under budget less
  hotfix room. Where it goes: the panel's five request fields and their parsing (~0.9 KB), `parseRequests` +
  `requestStart` + `wallMs` (~0.8 KB), Confirm time and the Bookings row (~0.7 KB), reserve rules (~0.35 KB), emails,
  booking page and ICS (~0.5 KB). Trimmed by sharing the schedule's day/closed-date validation and panel helpers.
  T174d (+0.8 KB) no longer fits Free as it stands: move the T162 setup check page first, or put T174d in Pro.
