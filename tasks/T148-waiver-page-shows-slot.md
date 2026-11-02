---
id: T148
title: "Waiver page shows the event and the booked date and time"
phase: 7
package: events-suite
edition: free
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T143]
spec: []
---

# T148 · Waiver page shows the slot

## Definition

From LMSC staging after T143: booking a clay slot (Wed 4 Nov 13:30) through `BookingWithWaiver` reaches
`/_events/waiver?ref=…` with the right occurrence on the booking, but the page
(`packages/events-suite/src/astro/WaiverPage.astro`) shows only the disclaimer and "Signing as
Test Booker (self)". The signer can't confirm which event and slot they are signing for. Show the
event title and the booked occurrence's date and time (in the event's time zone, same format as the
picker and the confirmation email) above the disclaimer, for each waiver mode.

## Acceptance criteria

- [ ] A test fails today: the waiver page for a booking shows the event title and its date and time.
- [ ] Slot-schedule and dated events both show it; the time is in the event's zone, not UTC.
- [ ] No new personal data on the page beyond what it shows now; works without JavaScript.
- [ ] Playground e2e or snapshot updated (the t065 waiver flow).
