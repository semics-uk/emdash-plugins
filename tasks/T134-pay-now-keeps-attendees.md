---
id: T134
title: "Events: Pay now keeps the attendees typed at checkout; booking_from per widget"
phase: 7
package: events
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T136]
spec: [R98, R96, R101]
---

# T134 · Events: Pay now keeps attendees

## Definition

R98's Pay now (a held payment the bank refused at approval) resumes through Free's
`public/checkout/continue`, which re-plans a non-waiver booking's attendees in the buyer's name (T077
resume), so names typed at checkout are lost. A resume of a booking that already has attendees must keep
them (and their waiver/signature state) and only re-run the payment step. Also from T130: the picker's
`booking_from` query parameter applies to every picker on a page; scope it per widget (e.g. keyed by the
widget/event id) with the no-JS links still working.

## Acceptance criteria

- [x] Tests first: Pay now resume keeps attendee names, emails, minors and signature state; the original T077 resume (no attendees yet) is unchanged; Pro holds editions test covers Pay now end to end
- [x] Two pickers on one page page independently, with and without JavaScript
- [x] Free bundle within budget (after T136's headroom); CONTEXT.md; changeset (patch)
- [x] T135 follow-ups: the booking page shows `3 × <ticket type id>` for UUID ticket ids (give `BookingStatus` the ticket names); `t130-day-picker` "keyboard roves" fails when the fixture's days straddle a month end (make the fixture date-independent); `t054` card snapshot is 3 px shorter on this machine (make it font-robust or tolerance)
- [x] Meets the Definition of Done

## Notes

- Decision recorded as R101. `public/checkout/continue` of a booking `awaiting_payment` that names no attendees
  reads its seats (`lockedAttendees`, +1 call: Free 6, Pro Pay now 8 = target) and writes them back unchanged when
  every seat is stored; missing seats fall back to the T077 behaviour (buyer's name). A continue that names
  attendees still writes them (no `ATTENDEES_LOCKED` outside waiver bookings with intents out).
- Pro: no source change (its paid confirm already keeps stored seats). Pro worktree
  `/Users/semics/code/semics/.pro-worktrees/agent-ab15fa203723a0f15` (branch `pro-agent-ab15fa203723a0f15`, commit
  `test(T134)`) extends `holds.editions.test.ts` "Pay now confirms" to assert seat names; it fails against public
  main (`['Ada Lovelace','Ada Lovelace']`) and passes against this branch. Its `node_modules/@semics-tech/{emdash-events,shared}`
  links were repointed at this worktree; run `pnpm install` in the Pro repo after landing.
- Picker: `booking_from.<eventId>` (`pickerParam`); an old plain `booking_from` link is ignored (opens on today).
- Booking page: one extra `public/event` call for ticket names (UI only); unlisted types read "3 tickets".
- t054: the card baseline was Linux (DejaVu Sans) and cannot match macOS fonts at any sane tolerance, so the
  snapshots are per OS (`__snapshots__/t054-events-list.spec.ts/{linux,darwin}/`); the darwin pair was generated here.
- t130: fixture is next month's first nine days; the "Book" button lookup is now exact (a fully booked day's
  button is named "…, fully booked", which matched once the day was always on the visible month).
- t135 Pay now e2e books through the public routes with three typed attendees (one minor), since the widget names
  every non-waiver seat after the buyer; it asserts the stored seats before/after Pay now and the "3 × Class place" line.
- Bundle: +49 B for the read, offset by `initial()` for Block Kit `initialValue` (13 sites): backend 123,698 B
  (76 B under T136's 123,774).
