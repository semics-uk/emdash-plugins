---
id: T129
title: "Events: slot schedules (several bookable time slots a day)"
phase: 7
package: events
edition: free
status: review
model: opus-5.5
size: L
depends_on: []
spec: [EV-FR-17]
---

# T129 · Events: slot schedules

## Definition

Sites that sell sessions in fixed slots (a range, a studio, a class) need many occurrences a day kept
from one central schedule, not one start time per RRULE. Add `config.schedule` to an event (Free):
`{ days: weekdays[], times: ["HH:MM"...], durationMinutes, capacity, bookAheadDays (default 56, max 90),
closedDates: ["YYYY-MM-DD"...] }`, local to `info.timezone`. An event has a schedule or a `recurrence`,
never both (`INVALID_SCHEDULE`). The recurring `occurrences` cron keeps every slot inside `bookAheadDays`
generated (raise the 20-date / `MAX_OCCURRENCES` limits for schedules only, e.g. 6 × 7 × 13 weeks;
check the config catalogue's storage-document size, R24, and the cron's call budget, and page if needed).
DST: a slot time that doesn't exist that day is skipped; an ambiguous one takes the first.

Admin, without touching the schedule: close or reopen one slot or a whole day, and change one slot's
places (an override on the occurrence that regeneration keeps). Booked slots are never moved or deleted
when the schedule changes (the T084 rule); closing a booked slot is refused with its bookings listed.
The editor panel gets a Schedule section (days, times, length, places, ahead, closed dates) and a day view
to close/reopen/change places.

## Acceptance criteria

- [x] Tests first: validation; generation across weeks, closed dates, DST (Europe/London both changes); regeneration keeps overrides and booked slots; limits and paging; cron call budget and CPU budget
- [x] Admin close/reopen/places per slot and per day; refused on a booked slot
- [x] Panel Schedule section and day view; works with existing tickets and capacity rules
- [x] Free bundle stays within its budget (R51): trim to offset, or record a decision if it can't
- [x] Decision recorded in BUILD-PLAN §12 (next R number); CONTEXT.md and the Events README updated; changeset (minor)
- [ ] Meets the Definition of Done

## Notes

- From a site plan (club session bookings); keep it generic, no site names in code or docs.
- T130 (day/time picker) builds on this; T131 (approval) runs in parallel in other files of this package.

## Review notes (T129)

- Design and limits are R94. Slots are ordinary occurrences `s-<eventId>-<start base36>`; the pure rules are
  `src/domain/schedule.ts`, the cron share `src/cron/schedule.ts`, the panel's Schedule fields and day view
  `src/admin/schedule.ts`. Shared files changed only where wiring needs it: `domain/config.ts` (validation,
  `INVALID_SCHEDULE`), `routes/config.ts` (`saveConfig` leaves a schedule-owned event's occurrences and catalog
  entries alone and bumps `slotsRev`), `cron/occurrences.ts` (dispatch), `admin/panel.ts` (fields, day picker,
  hides RRULE and dates for a schedule event), `routes/public-events.ts` (`public/event` asks for upcoming dates
  only), `domain/checkout.ts` (a schedule event needs a date even before its slots exist), `MANAGED_FIELDS`.
- Bundle: the feature costs ~8.3 KiB and the backend had 28 B of headroom, so it could not be offset by trimming
  without dropping a feature. Recorded as R94: the Free Events backend gets its own budget of 125 KiB
  (`EVENTS_BUNDLE_BUDGET` in `packages/shared/testing/bundle-size.ts`, 3 KiB under the registry cap); E-sign
  keeps 116. Now 124.1 KiB. T131 (approval) must trim first (candidates in R94).
- Budgets measured: cron tick 5 calls and 1-5 ms CPU in workerd while making 540 slots (6 a day, 90 days);
  idle tick 2 calls; panel save, day view, day save and a refused close all within 8 calls.
- Limits: at most 600 slots ahead (6 a day for 13 weeks fit; catalog ~90 KB, R24), 50 created a tick, a day
  save changes up to 5 slots. Changing a schedule's places or length applies to slots made afterwards
  (existing ones are changed in the day view). Clearing a schedule keeps its slots.
- Refused close lists bookings from the event's first 100 live bookings: bookings have no `occurrenceId`
  index and the manifest is unchanged.
- Follow-ups (not in scope): drift repair, `public/event/ics` and the admin date lists still read an event's
  first 100 or 50 occurrences, which for a schedule are the oldest. R94 was the next free number at the time;
  if T133 also took R94, renumber on merge.
- The DoD's automated code review is left to the review step.
