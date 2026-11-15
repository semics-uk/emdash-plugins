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

- 1 and 2 are the core feature ("request a time, staff confirm"). They overlap with Pro approval holds: the card
  hold expiry (about 7 days) limits how long a time can stay unagreed.
- Weigh Free Events bytes on any change (125 KiB budget, about 119 KB used). 1, 2 and 5 may fit better as Pro or
  suite features.
