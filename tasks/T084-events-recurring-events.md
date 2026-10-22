---
id: T084
title: "Events: recurring events"
phase: 5
package: events
edition: free
status: done
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

- [x] RRULE vectors match a reference expansion
- [x] DST transitions keep local times
- [x] Expansion never exceeds the window size per run
- [x] Editing a series keeps booked occurrences

## Implementation (green, then refactor)

- `packages/shared/src/rrule.ts`, `src/cron/occurrences.ts`

## Acceptance criteria

- [x] Within budget
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

Unblocked by R51 (Free backend budget 116 KiB, 12 KiB headroom); before that this task stopped
after the trimming (history in git: `chore(T084): blocked ...`).

Sizes of `dist/plugin.mjs` (`emdash-plugin build`; budget 118,784 B = 116 KiB since R51):

| State | Bytes | KiB |
| --- | --- | --- |
| Before (main after T081) | 114,312 | 111.6 |
| After trimming (refactor commit, no behaviour change) | 113,588 | 110.9 |
| With recurring events (final) | 118,653 | 115.9 (131 B under) |

The margin is thin: the next Free feature needs trimming or a budget decision first.

- `packages/shared/src/rrule.ts`: the RRULE subset (FREQ DAILY/WEEKLY/MONTHLY, INTERVAL, BYDAY with
  MONTHLY ordinals, BYMONTHDAY, COUNT or UNTIL, `EXDATE=YYYYMMDD,...` extension), python-dateutil
  semantics (DTSTART counts only when it matches). Reference vectors:
  `packages/shared/tests/fixtures/rrule/generate.py` (python-dateutil 2.9.0.post0 in a throwaway venv,
  zoneinfo fold=0; command in its docstring). 100% covered.
- `config.recurrence` is checked on save (`INVALID_RECURRENCE`, message in `admin/messages.ts`); the
  editor panel has a "Repeats (RRULE)" field. Clearing the rule keeps the dates already made.
- `src/cron/occurrences.ts`: recurring `occurrences` (`*/10 * * * *`), `SCHEDULES_FLAG` v10. Next 20
  dates (the window size, also the most one run creates) within 60 days, never past
  `MAX_OCCURRENCES`. Planned from each config's catalog, one event per tick (turns by ten-minute slot;
  KV `cron:occurrences` pages past 100 configs), saved through `saveConfig` with stored dates passed back
  unchanged, so booked dates are never moved or deleted (ITEM_IN_USE / capacity guards of T042/T044).
  A run either removes one stale unbooked series date (rule or start changed; past ones only when out
  of room) or creates the missing ones. <= 8 calls (kv 1 + page 1 + load 3 + writes <= 3).
- Known cost: after a rule edit, a booked date of the old rule keeps the event "with work" until that
  date passes, so the event's turns cost 5 reads and no writes; other events still get their turns.
  An event can also be stuck at `MAX_OCCURRENCES` booked dates (documented, not handled).
- A change of the entry's start time renames the whole series (ids carry the start): old unbooked
  dates go one per run (every 10 minutes), new ones arrive once those are gone.
- Pro (worktree `/Users/semics/code/semics/.pro-worktrees/agent-t084`, branch `pro-agent-t084`):
  `src/schedules.ts` moves the four Pro schedules into an `ensure-schedules-pro` one-shot queued from
  the `ensure-schedules` tick, which is now 7 calls (Free 5 + flag + 1), and the one-shot's tick 4.
  Land the public branch first: Pro's tests expect Free's five tasks.
