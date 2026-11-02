---
id: T151
title: "Waiver page: expired bookings say so; slot line survives a draft or paused event"
phase: 7
package: events-suite
edition: free
status: in-progress
model: opus-5.5
size: S
depends_on: [T148]
spec: []
---

# T151 · Waiver page for expired bookings and draft events

## Definition

From LMSC staging after T148 (booking `1AW8BTXB3T`, clay slot event):

1. The booking's hold ended (status `expired`), yet `/_events/waiver?ref=…` still renders the
   disclaimer and the signing form. An expired (or cancelled) booking should show "This booking has
   expired. Please book again." with a link to the event, and no signing form. Check the server side
   too: signing an expired booking must be refused (if it already is, add the test that proves it).
2. With the event's sales status moved to draft or paused, the T148 slot line disappears, title
   included, because `public/event` answers nothing for a draft event. A booking made while on sale
   should keep its title and date. Prefer data `public/booking` already returns (or can return
   cheaply) for the booking's own occurrence; the Events bundle has about 24 bytes of hotfix room
   (bundle-size test), so any Events change must trim an equal amount and say what.

## Acceptance criteria

- [ ] A test fails today: an expired booking's waiver page shows the expired message and no form.
- [ ] Signing an expired booking is refused server-side (test proves it).
- [ ] A test fails today: a booking on a draft or paused event still shows its title and date.
- [ ] Bundle-size test passes; any Events trim named in the report.
