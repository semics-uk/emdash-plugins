---
id: T050
title: "Events: confirmation email and calendar routes"
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T048, T015, T018]
spec: [EV-US-3, EV-FR-08, EV-FR-09]
---

# T050 · Events: confirmation email and calendar routes

## Definition

Confirmation email with links, and `public/booking/ics` / `public/event/ics` raw `text/calendar` behind signed links.

## Model

**Sonnet 5.5**: Wiring existing modules.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Email contains booking, ticket and ICS links and no attachment
- [ ] ICS route returns valid calendar with correct TZID
- [ ] Expired signed link fails

## Implementation (green, then refactor)

- `src/emails/confirmation.ts`, `src/routes/ics.ts`

## Acceptance criteria

- [ ] Snapshots in 3 zones
- [ ] Emails go through the shared outbox (T015): declare `OUTBOX_COLLECTION`, adapt `ctx.storage.outbox` to `OutboxStorage`, `drainOutbox` from the cron tick; delivery is at-least-once
- [ ] The queued `confirm-<bookingId>` row holds only `{ bookingId, bookingRef }` (T048): render at send time, read attendees then, issue a fresh access token for the emailed link (store only its hash); reconcile the schema `OutboxDoc` (`kind` + `payload`, string `nextAttemptAt`) with the shared `OutboxRecord`/`OutboxStorage`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
