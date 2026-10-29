---
id: T130
title: "Events: day-then-time picker on the booking form"
phase: 7
package: events
edition: free
status: done
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

- [x] Tests first: grouping by local day (timezone, DST), remaining/full, closed hidden, month paging, call budget
- [x] Picker in the booking form and the `events-booking` block; no-JS fallback; a11y (roving focus, labels)
- [x] Single-date events keep today's form unchanged
- [x] Free bundle within budget; CONTEXT.md and README updated; changeset (minor)
- [x] T129 follow-up: drift repair, `public/event/ics` and the admin date lists read an event's first 100/50 occurrences (the oldest for a schedule event); make them read upcoming ones
- [ ] Meets the Definition of Done

## Notes

- Design and limits are R96 (next free number on main when written; T131 runs in parallel: renumber on merge if it
  also took R96). Grouping by day, the calendar and paging live in the UI half (`src/astro/lib/picker.ts`,
  `src/client/picker.ts`), not in the registry bundle. Deviation from the definition's wording: `public/event` does not
  group by day itself; it returns flat upcoming dates (`available` per date) and the UI groups them, so the core needs
  no zone logic and stays within 125 KiB (127,623 B = 124.6 KiB, +508 B; 377 B left for T131, which must trim first per R94).
- `public/event`: `from` (ISO, a later string than now), two cursor pages of 100 (5 calls past 100, 4 otherwise),
  `more`, `slots`. Closed slots never listed (status `open`), full ones `available: 0`. The T129 test expecting 50
  slots now expects 200. Events Pro's MCP tools that wrap `public/event` get up to 200 dates.
- Paging is by month from `booking_from` (local `YYYY-MM-DD`); the widget asks from UTC+14 midnight and drops earlier
  slots; a truncated answer's last day moves to the next page. The parameter is not scoped per widget.
- R94 follow-ups: drift repair snapshots dates from 7 days back (earliest first), `public/event/ics` the next 50 upcoming,
  `config/get` a schedule-owned event's upcoming slots. `loadEventState` (panel, event editor, `saveConfig`) keeps
  the first 100 for non-schedule events on purpose: `saveConfig` diffs them, and the catalog's past dates feed cancel
  policy and retention; schedule-owned events never show or save their dates there.
- `booking.ts` focus on error: a fieldset now focuses its first live input or `button[tabindex="0"]` (the picker's day).
- Tests: `tests/ui/picker.test.ts` (grouping, DST, full, paging), `tests/ui/picker-client.test.ts` (keyboard),
  `tests/picker.runtime.test.ts` (route pages, closed hidden, budget, config/get), `tests/routes/ics.test.ts`,
  `tests/inventory.test.ts` (drift repair), `tests/ui/client-bundle.build.test.ts` (script size/sinks);
  playground `/e2e/picker` + `e2e/t130-day-picker.spec.ts` (no-JS select, JS picker, keyboard, error focus, axe, 320 px),
  and `/e2e/picker` joined the t101 page list.
- The DoD's automated code review is left to the review step.
