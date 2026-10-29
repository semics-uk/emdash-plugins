---
id: T129
title: "Events: slot schedules (several bookable time slots a day)"
phase: 7
package: events
edition: free
status: in-progress
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

- [ ] Tests first: validation; generation across weeks, closed dates, DST (Europe/London both changes); regeneration keeps overrides and booked slots; limits and paging; cron call budget and CPU budget
- [ ] Admin close/reopen/places per slot and per day; refused on a booked slot
- [ ] Panel Schedule section and day view; works with existing tickets and capacity rules
- [ ] Free bundle stays within its budget (R51): trim to offset, or record a decision if it can't
- [ ] Decision recorded in BUILD-PLAN §12 (next R number); CONTEXT.md and the Events README updated; changeset (minor)
- [ ] Meets the Definition of Done

## Notes

- From a site plan (club session bookings); keep it generic, no site names in code or docs.
- T130 (day/time picker) builds on this; T131 (approval) runs in parallel in other files of this package.
