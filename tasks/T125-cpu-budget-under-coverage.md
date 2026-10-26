---
id: T125
title: "CI: CPU budget checks and coverage"
phase: 6
package: esign
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T106]
spec: [R53, R64]
---

# T125 · CI: CPU budget checks and coverage

## Definition

CI run 40285880845 fails one test of 606: `packages/esign/tests/download.routes.test.ts` "ES-FR-08 a large
PDF round-trips through chunked storage", `BudgetExceededError: hook "cron" used CPU 69.0 ms (limit 50 ms)`.
CI runs `test:verify` with coverage and the budget is strict on CI (`packages/shared/testing/budget.ts`
~L318). First decide which it is: (a) a real overrun on a GitHub runner without coverage, or (b) coverage
instrumentation inflating CPU. Measure both on CI if needed (a throwaway workflow_dispatch or a branch run).
(a) means fix the code (the cron must stay inside 50 ms for the largest supported PDF). (b) means budgets are
enforced strictly in a run without coverage, and coverage runs don't fail on CPU, without weakening the
local or CI guarantee.

## Acceptance criteria

- [x] Cause recorded (a or b) with the measured numbers, in this file and as a §12 row if behaviour changes
- [x] Test first, then the fix
- [x] CI green on main in semics-uk/emdash-plugins (run id recorded)
- [x] Meets the Definition of Done

## Notes

- **Cause: (a)**, a real overrun on a GitHub runner, not coverage. The ~354 KB large-PDF test on CI
  (run 40287029213, 4 vCPU): no coverage 41-46 ms alone, 45-57 ms in the full suite; with coverage
  45-52 ms. Locally 30 ms with or without coverage. Budgets stay strict on CI, coverage or not.
- Fix: chunk base64 by lookup table (was `String.fromCharCode` + `btoa`, ~12 ms of ~30 ms locally,
  now ~1 ms); `layoutLines` finds words with `indexOf` and slices whole lines (identical bytes).
- Nothing bounded the snapshot (`MAX_DOCUMENT_BYTES` is the 512 KiB storage-document limit, R24), and
  cost grows with lines as well as characters, so `renderSnapshot` now refuses a snapshot over
  `MAX_SNAPSHOT_CHARS` (131,072) or `MAX_SNAPSHOT_LINES` (1,500) with `DOCUMENT_TOO_LARGE` (R92).
  The costliest allowed document (both limits, as list items) on CI, run 40295515030: 256 KiB/2,000
  lines 39-50 ms, 192 KiB/1,500 30-43 ms, **128 KiB/1,500 27-28 ms** incl. full suite with coverage.
- `depends_on` changed from T123 to T106: T123 (CI green) needs this task, and the board check failed
  CI with "T125 is in-progress but T123 is in-progress".
- CI green on main: run 40299441395 (commit 6e6fa83).
- Follow-ups: the template editor accepts 100,000 characters but not a line limit, so a template of
  more than 1,500 lines saves and is refused at send; the Pro repo should handle the new
  `DOCUMENT_TOO_LARGE` issue code if it switches on `EnvelopeIssueCode`.
