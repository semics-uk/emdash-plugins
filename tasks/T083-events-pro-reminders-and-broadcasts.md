---
id: T083
title: "Events Pro: reminders and broadcasts"
phase: 5
package: events
edition: pro
status: backlog
model: sonnet-5.5
size: S
depends_on: [T057]
spec: [EV-FR-08]
---

# T083 · Events Pro: reminders and broadcasts

## Definition

Scheduled reminders at configurable offsets and broadcast emails for updates and cancellations.

## Model

**Sonnet 5.5**: Cron and outbox wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Reminder queued at T−24h exactly once
- [ ] Broadcast reaches every confirmed attendee in batches within budget

## Implementation (green, then refactor)

- `src/cron/reminders.ts`, `src/domain/broadcast.ts`

## Acceptance criteria

- [ ] Opt-out link
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
