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

- [x] RRULE vectors match a reference expansion
- [x] DST transitions keep local times
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

## Notes

**Blocked on the Free bundle budget (R47); needs an owner/orchestrator decision.** Done so far: the
trimming (no behaviour change) and the shared `rrule.ts` with its reference vectors. The events wiring
(cron materialiser, config validation, panel section) is not merged because it does not fit.

Sizes of `dist/plugin.mjs` (`emdash-plugin build`, the bundle `bundle-size.build.test.ts` checks;
budget 114,688 B = 112 KiB):

| State | Bytes | KiB | vs budget |
| --- | --- | --- | --- |
| Before (main after T081) | 114,312 | 111.6 | -376 |
| After trimming (refactor commit) | 113,588 | 110.9 | -1,100 |
| + recurrence, untested probe (branch `t084-size-probe`) | 118,222 | 115.5 | **+3,534** |
| probe minus the duplicate `/events` admin editor | 116,302 | 113.6 | +1,614 |

The probe is the smallest wiring I could write: `src/cron/occurrences.ts` reusing `saveConfig` (one
event per tick), the `recurrence` check in `validateConfig`, one message, one panel text field and the
task registration. `rrule.ts` alone is about 2.9 KiB minified (esbuild metafile); the rest about 1.6 KiB.

Trimmed without behaviour change (all 631 events tests green): one copy each of the settings-to-object
conversion (`src/domain/settings.ts`, 8 call sites), the admin price diff and sold meter (`admin/ui.ts`,
editor page and panel), checkout continue's extend-write-rearm step (`advance`, Pro pay and sign paths)
and the outbox's event lookup. The code is already dense (T118); what is left is mostly prose (6.9 KB
of strings with spaces, about half of it admin copy, the rest emails and error messages) and the
shared error registry.

Options (none taken; the brief forbids raising the budget here):

1. Raise the Free backend budget by 4 KiB to 116 KiB (12 KiB of headroom under the registry's 128 KiB,
   R47 currently keeps 16). Simplest; recurrence then fits with about 0.5 KiB spare.
2. Remove the Block Kit `/events` editor page (status, capacity, prices), which the T043 editor panel
   supersedes: -1.9 KiB, a behaviour change. Still 1.6 KiB short, so it would also need shortened admin
   copy (about -1 KiB realistic) and a smaller feature (for example no panel field: rules set through
   `config/save` only).
3. Split `ERROR_CODES` so Events carries only its own codes (about -1.2 KiB). Pro passes its own codes
   (licence, protocol, pairing) through Free's `fail` via the seams, so Pro would have to bring their
   messages: a seam change in both repos.
4. Run the expansion outside the sandbox: the native integration half could expand rules and call a
   private core route that writes the dates (rrule.ts stays out of the core bundle; the core keeps only
   the write route). Needs the native half installed and a trigger (admin save or a native cron), so
   it is a design change.

Recommendation: option 1, then finish the wiring from the probe (it reuses `saveConfig`, so the
ITEM_IN_USE and capacity guards of T042/T044 apply to every series edit).

Design for the wiring (from the probe, to finish once there is room):
- `config.recurrence` holds the rule text (`parseRrule` checks it on save: `INVALID_RECURRENCE`).
  DTSTART is the entry's `info.startsAt` in `info.timezone`; each date gets the config capacity and
  the entry's length.
- Recurring task `occurrences` (`*/10 * * * *`) in `RECURRING_TASKS`, `SCHEDULES_FLAG` to v10. A tick
  queries the configs (1), picks the first recurring event whose catalog lacks a date of the next 60
  days (at most 20 per run, the window size, and never past `MAX_OCCURRENCES`) or still lists a stale
  series date, loads it (3) and saves through `saveConfig` (reserved calls 1): adds with deterministic
  ids `r-<eventId>-<start base36>`, removes at most one stale unbooked series date per run; booked
  dates are always kept (never deleted or moved). <= 8 calls.
- Pro: its `ensure-schedules` tick is 4 Pro schedules + Free's list + the flag = 9 today; a fifth Free
  task makes it 10 (the hard limit, over the target). Pro should move its four schedules into a
  follow-up one-shot (`ensure-schedules-pro`, queued by the ensure tick: 1 call) so both ticks stay
  <= 8, or Free should fold `occurrences` into an existing task instead of adding one.

Reference vectors: `packages/shared/tests/fixtures/rrule/generate.py` (python-dateutil 2.9.0.post0 in a
throwaway venv, zoneinfo fold=0); the command is in its docstring. dateutil semantics: DTSTART counts
only when it matches the rule. `EXDATE=YYYYMMDD,...` is this subset's extension (local dates).
