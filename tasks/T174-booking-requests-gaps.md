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

## T174c notes (2026-11-16)

- **Shapes.** `booking.request.proposed = { startsAt, endsAt?, at }` (Pro writes it; Free's schema type is unchanged). The
  deadline (`holdExpiresAt` = `approval.until`, so Free's `undecided` still holds) moves to the earlier of now +
  `proposalHours` (Pro setting, default 72, 1–720) and the proposed start; a card authorised at checkout (`hold: manual`)
  is never given a later deadline (gap: a manual hold cannot be extended past its authorisation).
- **Admin.** Block Kit forms have one submit, so Pro copies Free's Confirm time form into a second form, "Propose another
  time" (`bookings.propose:<id>`), block id `p:<zone>` (block ids are React keys and must differ). Propose rewrites
  `lapse-<id>` for the new deadline, queues `propose-<id>` (`time_proposed`), and moves the settle one-shot.
- **Buyer.** `public/booking/request/accept` / `.../refuse` (Pro, in flight). Accept: Free's `approveBooking` (paid) or
  Pro's `approveHeld` (held) with the proposal as `time`; a lost race answers through Free's approve again (double accept
  ok; after decline, expiry or refusal `HOLD_EXPIRED`). Refuse: Free's cancel with the refund step (status `cancelled`,
  the refund email), only while a proposal waits. `public/booking` answers `proposed`; `BookingStatus` shows it with two
  plain forms (`intent=accept-time|refuse-time`) that `BookingPage` answers with the cookie's token.
- **Race left open.** An accept read just before a re-proposal confirms the time the buyer saw (the old proposal).
- **Bytes.** Free backend unchanged (Astro and i18n only). Pro 257,470 → 257,928 B: T174c +2,451, paid for by a shared-helper
  refactor (−1,993; `src/route-util.ts`). 4,216 B left for T174d/e.

## T174e notes (2026-11-16)

- **Shape.** No new field: a request's per-attendee waiver is stamped `after: true` at reserve (Pro, `stampWaiver`), paid or
  free and whatever `waiverTiming` says (`off` still drops it; a buyer-signed waiver keeps signing first, inline, nothing
  emailed). Continue goes straight to payment (or, free, to the organiser); Pro writes a free request's seats `pending`
  (Free's `done` step writes `valid`), so check-in still asks for the waiver.
- **Unnamed seats.** Free plans a continue without attendees in the buyer's name and address. `planWaiverIntents({ later })`
  skips a request's adult seat with the buyer's address past seat 1 (the buyer's own) instead of `WAIVER_EMAIL_REQUIRED`;
  the signing list reports it `signs: "none"`, and Sign now refuses it.
- **Nothing before confirm.** `listed` is false for a request until `confirmed`: no signing list on `public/booking`, and
  Sign, Resend and edits answer `ATTENDEES_LOCKED`. Free's request-received email is untouched.
- **After confirm** (Confirm time, accepting a proposal, or a paid approve, all through Free's approve): the
  confirmation email gets "add each attendee's names and emails" with the booking link; the edit window runs to the cutoff
  before `booking.time`; `signingList.minors` lets the edit mark a request's seat under 18 (`minor` is refused on other
  bookings); an edit invites only seats given their own address.
- **Widget.** Events' `<BookingWidget>` has no attendee step (no change). The suite's `<BookingWithWaiver>` shows the plain
  ticket and quantity group for a waiver request (the `waiverEach` input disabled, so no seat check), plus a note; it is
  the same plain form without JavaScript. The booking page's `AttendeeList` gets the unnamed note and the Under 18 box.
- **Bytes.** Free backend unchanged (Astro and i18n only). Pro 257,940 -> 258,549 B (+609); 3,595 B left for T174d.
- **Gaps.** A seat still unnamed at the door gets the door link in the buyer's name (as before for any seat in the
  buyer's name); after the edit cutoff an unnamed seat can only be signed that way. The "Sign the waiver" step hides
  while only unnamed seats wait.

## T174d notes (2026-11-16)

- **Where it lives.** Free has only the hook (net −37 B): a booking line may carry `addon: true`; `seatCount(lines)` (places
  only) feeds `countersForBooking` (the occurrence and event totals; the add-on keeps its own ticket-type counter), so
  reserve, release, confirm, the webhook's late re-reserve and drift repair all agree; `planAttendees` and the receipt
  `seatIds` skip add-on lines; the approval and offer emails count places. `planCheckout` copies `addon` from the
  catalog type onto the line (and plans the reservation from those lines). `addons` (the event's add-on ticket type ids)
  is in `MANAGED_FIELDS`, so Free's own ticket form save never touches it.
- **Pro (`src/addons.ts`).** The ticket panel and the Event editor page get an "Add-ons" form: a toggle per ticket type,
  "<name>: Add-on (per person, not a place)", `addons.save` (licence first; `saveConfigFields`, shared with the waiver
  order form) writes `config.addons`. Reserve (inside `reserveWithAnswers`, no extra call): the config read comes back with
  the listed catalog types marked `addon`; when Free writes the draft, an add-on line above the order's places, or add-ons
  alone, is refused `BAD_REQUEST` with `{ path: "lines", code: "INVALID_QUANTITY" }` (after rate limit and Turnstile,
  before any seat). `public/event` marks add-on types `addon: true`. The webhook's attendee fallback, the reminder's ticket
  count and the reports' `tickets` count places (`byType` keeps the add-on's line and revenue).
- **Widgets.** `<BookingWidget>`: an "Add-ons" fieldset under the tickets (`data-testid="booking-addons"`, "£54 a person"),
  each input capped live at the places chosen (`addonMax`); add-ons alone fail the client's tickets check; the waitlist
  lists places only. `<BookingWithWaiver>`: `addon:<id>` quantities under the tickets or attendees, posted as lines after
  the places, capped live (`addonCap`) by the plain quantity or the named rows. Without JavaScript the server refuses.
  The booking page lists the add-on line and counts only places as tickets.
- **Bytes.** Free backend 123,131 → 123,094 B (−37; 810 B under budget less hotfix room). Pro 258,549 → 260,221 B
  (+1,672; 1,923 B left under 256 KiB), after moving the waiver order's save into a shared helper.
- **Gaps.** The admin Bookings table still shows no lines (the total only; the booking page and Pro's reports by type
  show the add-on). A waitlist join with "any ticket" picks the catalog's first visible type, which could be an
  add-on (the widget lists places only; an offer's line carries no mark, so it would count as places). Marking or
  unmarking a type changes new bookings only. Found while testing, not fixed here: Free's ticket form save sets the
  event's `waiverTiming` and `waiverAllowDecline` (T160, Pro) to null, because `counterlessChanges` nulls config keys
  the form does not send; adding both to `MANAGED_FIELDS` (about +40 B) would fix it.
