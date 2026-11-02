---
id: T143
title: "Suite BookingWithWaiver uses the day/time slot picker for slot-schedule events"
phase: 7
package: events-suite
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T141]
spec: []
---

# T143 · Suite booking uses the slot picker

## Definition

`packages/events-suite/src/astro/BookingWithWaiver.astro` shows a plain date `<select>`. For a
slot-schedule event (T129) `BookingWidget.astro` shows the day/time picker (T130,
`src/astro/lib/picker.ts`, `src/client/picker.ts`). Reuse that picker in the suite component so a
site using waivers gets the same booking flow. Dated events keep the select.

## Acceptance criteria

- [x] A test fails today: BookingWithWaiver for a slot-schedule event renders the picker, not a select.
- [x] Booking through it reaches the waiver step with the chosen slot (playground e2e).
- [x] Dated events unchanged (existing snapshots pass).

## Notes

- `BookingWithWaiver.astro` reuses `usesPicker`, `pickerView`, `pickerFetchFrom`, `pickerHref`, `pickerParam`
  (`@semics-tech/emdash-events/astro/lib/picker`), Events' `i18n` translator and `client/picker`. Nothing forked
  except the picker's scoped CSS and markup, copied under `.semics-waiver-widget` (Astro scopes styles per component).
  The picker pages `public/event` with `from`, as the widget does (T134).
- tests/boundaries.test.ts now also allows the `@semics-tech/emdash-events/i18n` and `client/picker` entries.
- Tests are source-level like the repo's other component tests (tests/slot-picker.test.ts); there is no Astro container renderer here.
- Criterion 2 in the Free playground: slot schedules and waivers are Pro, so `/e2e/waiver-picker` (fixed data) is
  used and the test answers the `/_events/waiver` post itself, asserting it carries `intent=book` and the chosen
  `occurrenceId`. The real waiver step with Pro is covered by flow.test.ts (T065) and needs a Pro build.
- Dated events unchanged: existing t065 e2e and the suite tests pass; the select is kept when `usesPicker` is false.
