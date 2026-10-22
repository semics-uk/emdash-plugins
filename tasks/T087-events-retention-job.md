---
id: T087
title: "Events: retention job"
phase: 5
package: events
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T057]
spec: [EV-FR-20]
---

# T087 · Events: retention job

## Definition

Daily job deletes booking personal data 12 months after the event (configurable) and supports deletion on request.

## Model

**Sonnet 5.5**: Contained job.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Data older than the period is purged; newer kept
- [x] On-request deletion removes personal fields but keeps counts

## Implementation (green, then refactor)

- `src/cron/retention.ts`

## Acceptance criteria

- [x] Within budget
- [x] Bookings' `ipHash` is cleared once the reserve rate window has passed: without a Turnstile secret it is salted with the public plugin id and reversible over IPv4 (T057 review F6)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- `src/cron/retention.ts`: recurring `retention` task (`17 * * * *`) plus one-shot `retention-more`; state in KV `cron:retention`. Phases per pass: `ips` (clear `ipHash` an hour after creation; one `updateIf` each, 4 per tick), `bookings` (at most every 20 h; event ended more than `retentionDays` ago; keyset cursor, attendee cursor, and a `floor` so erased bookings are not rescanned), `outbox` (delete sent/failed rows older than the period). Ticks are at most 8 calls (asserted in fake and workerd tests).
- `eraseBookings` is shared with the admin. Erased bookings keep ref, status, lines, totals and counters; they lose buyer, email, answers, `ipHash`, `redeemHash`, `accessTokenHash` and get `erasedAt`. Attendees lose name and email (code and status stay). Live bookings (draft/held/awaiting/confirmed with a future or unknown event date) are never erased.
- Admin: the bookings page has a "Delete personal data" form (reference or buyer email), a preview step, then a danger button with a confirm dialog (`retention.preview`, `retention.erase` on the private `admin` route; typically 8 calls or fewer, 10 worst case with a second attendee page). On request it also deletes sent/failed outbox rows to those buyers (new `outbox` index on `to`).
- `SCHEDULES_FLAG` is now `cron:scheduled:v3` (shared; esign re-runs its ensure task once, its test updated).
- Limits: waitlist rows (email, no index) are not erased; an order with more than about 200 attendees needs the admin deletion run twice.
- Free bundle: dist/plugin.mjs 100.3 KiB (limit 104).
