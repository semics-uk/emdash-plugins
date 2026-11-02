---
id: T143
title: "Suite BookingWithWaiver uses the day/time slot picker for slot-schedule events"
phase: 7
package: events-suite
edition: free
status: in-progress
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

- [ ] A test fails today: BookingWithWaiver for a slot-schedule event renders the picker, not a select.
- [ ] Booking through it reaches the waiver step with the chosen slot (playground e2e).
- [ ] Dated events unchanged (existing snapshots pass).
