---
id: T081
title: "Events: waitlist with timed offers"
phase: 5
package: events
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T057]
spec: [EV-FR-16, EV-US-6]
---

# T081 · Events: waitlist with timed offers

## Definition

Join when sold out; freed seats trigger offers with a 24-hour claim link; unclaimed offers pass on; claim reserves inventory.

## Model

**Opus 5.5**: Concurrency with inventory.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Freed seat offers to the earliest entry
- [ ] Expired offer moves to the next
- [ ] Two claims for one seat: one wins
- [ ] Cron batches within budget

## Implementation (green, then refactor)

- `src/domain/waitlist.ts`, `src/cron/waitlist.ts`

## Acceptance criteria

- [ ] Emails via outbox
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
