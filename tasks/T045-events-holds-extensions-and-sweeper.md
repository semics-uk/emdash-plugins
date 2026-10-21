---
id: T045
title: "Events: holds, extensions and sweeper"
phase: 2
package: events
edition: free
status: review
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

- [x] Extension never passes the ceiling
- [x] Expired hold is released within one sweep
- [x] Sweep is resumable across runs (cursor in KV)
- [x] A sweep batch stays within budget

## Implementation (green, then refactor)

- `src/domain/holds.ts`, `src/cron/sweep.ts`

## Acceptance criteria

- [x] Clock injected for tests
- [x] One-shot `hold-<ref>` cron tasks are only an accelerator; `sweep-holds` is the source of truth (max 10 due tasks per tick, S3, T005)
- [x] Call `release` (T044) before a booking moves to expired/cancelled/refunded; drift repair runs with a cursor across ticks (`repairEventCounters` returns `complete: false` on large events); optional cleared fields on counted documents are `null`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **pnpm verify is not green yet, but only because of the environment.** First run: every events-package failure was `[vitest-pool]: Timeout starting cloudflare-pool runner` (16, load average about 15 from parallel agents). There were no assertion failures, so the events coverage summary read 0% because no pool started. The re-run was stopped by Claude Code for low system memory. Run `pnpm verify` again on a quiet machine before marking done. Run individually, everything passed: typecheck, Biome, `tests/domain/*` + `tests/cron/sweep.test.ts` (72 tests), `tests/cron.hook.test.ts` (runtime host, 2), and `tests/holds.test.ts` (sandbox on D1, 6).
- Red: holds.ts and sweep.ts were stubbed (plus `restore`, `mergeRefs`, `repairStep`), and all 25 unit tests failed with `T045: not implemented` (commit 205560d). The sandbox suites call the same stubs and were not re-run red, to save about 7 minutes of workerd time.
- Expiry protocol: **claim** (`releaseClaimedAt` set by an `updateIf` guarded on status, holdExpiresAt and `releaseClaimedAt: null`), then **release** (merged per counted document), then **move** to `expired` guarded on the claim. A move that misses calls the new `restore` (an over-count is safe). Stale claims (>2 min) and dead drafts are closed without releasing, and the event is marked dirty for drift repair.
- **Follow-up for checkout/confirm/cancel tasks (T046+):** any write that changes a held booking (draft to held, extend, confirm, cancel, refund) must guard on `releaseClaimedAt: null` and the status it read, and treat a miss as "hold lapsed". Use `startHold`/`extendHold`/`stepTarget`/`holdSettings`, and schedule the accelerator with `scheduleHoldTask` (one call).
- Drift repair across ticks: the new `repairStep` (inventory.ts) does snapshot, then paged scan (stable created_at/id cursor), then guarded writes, with its job in KV `cron:sweep-holds`. It targets dirty events first, then a rolling pass over `on_sale`/`paused` event configs. `repairEventCounters` (T044) is unchanged.
- Budget: a sweep tick makes at most 8 calls (KV read + expiry query + claims/merged releases/moves + optional `sweep-holds-more` continuation + KV write). A one-shot makes at most 8. A backlog drains at the next minute tick through the continuation.
- New hooks: `plugin:activate` schedules `sweep-holds` `*/5 * * * *`, and `cron` dispatches. The manifest is unchanged (cron needs no capability). `BookingDoc` gains optional `releaseClaimedAt` and `expiredAt`. Changeset: `.changeset/events-holds-sweeper.md`. Nothing here clears optional fields on counted documents.
