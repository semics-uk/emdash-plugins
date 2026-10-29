---
id: T130
title: "Events: day-then-time picker on the booking form"
phase: 7
package: events
edition: free
status: ready
model: opus-5.5
size: M
depends_on: [T129]
spec: []
---

# T130 · Events: day-then-time picker

## Definition

With many occurrences (T129 schedules), the booking form's flat date list is unusable. When an event has
more than one occurrence on any day (or a schedule), the form shows a month calendar of days that have
slots, then that day's times with places left; full slots are shown as full and disabled, closed ones
not at all. `public/event` returns what the picker needs in one call (occurrences grouped by local day
with remaining places, paged by month if large) within the route's call budget. Without JavaScript the
form falls back to a plain list of dates and times grouped by day, as the current form does. Keyboard
and screen-reader accessible; uses the existing i18n tables.

## Acceptance criteria

- [ ] Tests first: grouping by local day (timezone, DST), remaining/full, closed hidden, month paging, call budget
- [ ] Picker in the booking form and the `events-booking` block; no-JS fallback; a11y (roving focus, labels)
- [ ] Single-date events keep today's form unchanged
- [ ] Free bundle within budget; CONTEXT.md and README updated; changeset (minor)
- [ ] T129 follow-up: drift repair, `public/event/ics` and the admin date lists read an event's first 100/50 occurrences (the oldest for a schedule event); make them read upcoming ones
- [ ] Meets the Definition of Done
