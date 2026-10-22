---
id: T083
title: "Events Pro: reminders and broadcasts"
phase: 5
package: events
edition: pro
status: review
model: sonnet-5.5
size: S
depends_on: [T057, T071]
spec: [EV-FR-08]
---

# T083 · Events Pro: reminders and broadcasts

## Definition

Scheduled reminders at configurable offsets and broadcast emails for updates and cancellations.

## Model

**Sonnet 5.5**: Cron and outbox wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Reminder queued at T−24h exactly once
- [x] Broadcast reaches every confirmed attendee in batches within budget

## Implementation (green, then refactor)

- `src/cron/reminders.ts`, `src/domain/broadcast.ts`

## Acceptance criteria

- [x] Opt-out link
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- Decision R57 (BUILD-PLAN §12). Everything that sends is Pro code (`emdash-plugins-pro`,
  `packages/events-pro`): `src/cron/reminders.ts`, `src/domain/broadcast.ts`, `src/cron/broadcast.ts`,
  `src/mail/renderers.ts`, `src/mail/opt-out.ts`, `src/admin/broadcasts.ts`. The Free Events backend gained
  nothing (still 115.9 KiB); only the shared schedules flag string changed (`v10` -> `v11`, same length).
- Reminders: recurring `reminders` (`*/15`), scheduled by the `ensure-schedules-pro` one-shot (now 5 Pro
  tasks, still within 8 calls; flag bumped to v11 so already scheduled sites pick it up). Pro setting
  `reminderHours` (string, default "24", up to three offsets, empty = off). Windowed in KV `cron:reminders`
  plus a read-back of `remind-<h>h-<bookingId>` before writing, so exactly once per booking and offset.
  Queuing is new work (`events/reminder-schedule`, licence read). <= 8 calls.
- Broadcasts: new admin page `/broadcasts` ("Email attendees", Pro manifest page and `broadcasts` collection).
  Sending is new work (licence read); the `broadcast-<id>` one-shot pages confirmed bookings 10 per tick,
  recipients = buyer + each seat's own address, deduplicated, max 10 per booking (R48). 7 calls per tick.
  A cancellation notice is an email only: it does not cancel or refund anything.
- **Deviation from "rows hold ids only":** a broadcast row carries the admin's subject and message (no
  token, code or personal data beyond `to`), so the Free drain needs no extra read to render it.
- Opt-out: plugin routes cannot answer HTML and a GET side effect would let mail scanners unsubscribe
  people, so the link goes to a new Free UI page `/_events/opt-out` (MIT, like the R54 check-in screen) whose
  button POSTs to Pro's public `public/mail/opt-out`. Signature: HMAC over ref + recipient keyed by the
  booking's `accessTokenHash` (no KV read in the drain). Known limit: redeeming an emailed booking link
  replaces that hash, so earlier opt-out links stop working ("use the most recent email").
  Opted-out recipients get no reminders or updates; cancellation notices always go out, without the link.
- Mail throughput is the Free drain's 2 messages a minute; a large broadcast takes a while to deliver.
- Events Pro backend: 203.7 KiB (was 197.5; ceiling 256), leaving ~52 KiB for T086.
- Tests. Pro: `tests/reminders.unit.test.ts`, `tests/broadcast.unit.test.ts`, `tests/reminders.editions.test.ts`
  (end to end on the built Pro and Free cores, with budgets), plus the schedules and build-suite updates.
  Public: `tests/ui/opt-out.test.ts`, the integration and csrf build tests, the self-schedule flag tests.
  No playground e2e: the page is a plain form over one route, covered by the unit and build tests.
