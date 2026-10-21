---
id: T045
title: "Events: holds, extensions and sweeper"
phase: 2
package: events
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T044, T005]
spec: [EV-FR-06, EV-US-2, R1]
---

# T045 · Events: holds, extensions and sweeper

## Definition

15/35-minute holds, step extensions up to the 60-minute ceiling, and the `sweep-holds` cron releasing expired holds in cursor-driven batches.

## Model

**Opus 5.5**: Time-dependent concurrency.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Extension never passes the ceiling
- [ ] Expired hold is released within one sweep
- [ ] Sweep is resumable across runs (cursor in KV)
- [ ] A sweep batch stays within budget

## Implementation (green, then refactor)

- `src/domain/holds.ts`, `src/cron/sweep.ts`

## Acceptance criteria

- [ ] Clock injected for tests
- [ ] One-shot `hold-<ref>` cron tasks are only an accelerator; `sweep-holds` is the source of truth (max 10 due tasks per tick, S3, T005)
- [ ] Call `release` (T044) before a booking moves to expired/cancelled/refunded; drift repair runs with a cursor across ticks (`repairEventCounters` returns `complete: false` on large events); optional cleared fields on counted documents are `null`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
