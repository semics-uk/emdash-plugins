---
id: T125
title: "CI: CPU budget checks and coverage"
phase: 6
package: esign
edition: free
status: in-progress
model: opus-5.5
size: S
depends_on: [T123]
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

- [ ] Cause recorded (a or b) with the measured numbers, in this file and as a §12 row if behaviour changes
- [ ] Test first, then the fix
- [ ] CI green on main in semics-uk/emdash-plugins (run id recorded)
- [ ] Meets the Definition of Done
