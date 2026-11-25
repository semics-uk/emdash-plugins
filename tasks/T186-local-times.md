---
id: T186
title: "Emails and event cards show local time without the zone's name"
phase: 8
package: events
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T157]
spec: []
---

# T186 Local times without the zone's name

From the LMSC staging test (2026-11-07): times should read as UK time, not "10:30 UTC (Europe/London)". T157 fixed the
booking pages; the emails and the event list cards still named the zone.

## Done

- `formatWhen` (every Events and Events Pro email: confirmation, hold, waitlist offer, request deadline, pay-now,
  proposed time, refund) reads "Sat 14 Nov 2026, 19:00", without "(Europe/London)". A missing or invalid zone still
  shows UTC and says so: "19:00 (UTC)".
- `eventWhen` (the `<EventList>` cards) drops `timeZoneName`, which read "GMT", "GMT+0" or "GMT+11" depending on the
  runtime; an unknown zone says "(UTC)", as `zonedAt` does.
- Tests: `tests/emails/confirmation.test.ts`, `tests/emails/outbox.test.ts`, `tests/ui/list.test.ts`, the i18n snapshot,
  e2e `events.spec.ts`, `t054-events-list.spec.ts` and the t102 aria snapshots; Pro `holds.unit` and
  `propose-time.editions`.

## Not changed

- E-sign's audit certificate keeps UTC with the label: it is a record, and UTC is what it promises.
- Admin pages keep "(Europe/London)" in column headings and inputs, where staff type times in that zone.
- A repeated local time on the night the clocks go back reads the same twice (01:30), as on the pages.
