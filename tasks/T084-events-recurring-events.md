---
id: T084
title: "Events: recurring events"
phase: 5
package: events
edition: free
status: in-progress
model: opus-5.5
size: L
depends_on: [T057, T018]
spec: [EV-FR-17]
---

# T084 · Events: recurring events

## Definition

`rrule-lite` (daily, weekly, monthly, count, until, by-day, exclusions) and occurrence expansion in bounded windows from cron.

## Model

**Opus 5.5**: Calendar maths with edge cases.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] RRULE vectors match a reference expansion
- [ ] DST transitions keep local times
- [ ] Expansion never exceeds the window size per run
- [ ] Editing a series keeps booked occurrences

## Implementation (green, then refactor)

- `packages/shared/src/rrule.ts`, `src/cron/occurrences.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
pnpm --filter @semics-tech/emdash-events verify
```
