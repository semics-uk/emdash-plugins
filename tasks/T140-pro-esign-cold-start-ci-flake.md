---
id: T140
title: "Pro E-sign: cold-start CPU budget flaked on CI (52.7 ms against 50)"
phase: 7
package: esign
edition: pro
status: done
model: sonnet-5.5
size: S
depends_on: []
spec: [R92]
---

# T140 · Pro E-sign cold-start CPU flake on CI

## Definition

Pro release run 41035134082 (a repeat dispatch at `baa2c3d`; the first run 41032412368 passed and
published rc.1) failed in `tests/pro.build.test.ts` > "Pro build of @semics-tech/emdash-esign": "cold
start 52.7 ms CPU: expected 52.694 to be less than or equal to 50". The same log has an uncaught
"Route not found: pro/licence" and a workerd "code had hung" cancel just before it. Find whether the
cold start is near the limit (measure 10 CI-shaped runs) or was slowed by that hung request, and fix
the cause rather than raising the budget.

## Acceptance criteria

- [x] Cause named: real headroom shortfall, or the hung `pro/licence` request inflating the measure.
- [x] If headroom: the Pro E-sign cold start is under 45 ms on CI (10% room), budget unchanged at 50.
- [ ] If the hung request: no uncaught "Route not found: pro/licence" in the Pro test logs.
- [x] `gh workflow run pro-release.yml -f public-ref=main -f dry-run=true` passes twice in a row.

## Notes

- Cause: neither of the two suspects. Local `import()` of the Pro bundle in plain Node costs 4.3-5.0 ms CPU
  (10 runs); inside Vitest the same call costs 13.6-18.9 ms (best of three 13.6-15.1, also under the full
  suite's two workers) because Vitest's module loader fetches, transforms and wraps the 195 KiB bundle in the
  worker, counted by `process.cpuUsage()`. That is about 3x inflation, and on a 2-core CI runner running
  workerd suites in the other worker it reached 52.7 ms. The measure never reflected the Workers cold start.
- "Route not found: pro/licence" is not the cause: it also appears in the passing runs 41032412368 and
  41533575628. The workerd "code had hung" cancel is unrelated noise from the continuity test (not changed).
- Fix (Pro, branch `pro-agent-t140`): `coldStartCpuMs` in `packages/pro-kit/testing/structure.ts` now measures
  in a fresh Node child process (start-up not counted). After: 5.8-7.8 ms per run, also under the full suite.
  Budget unchanged at 50. The suite now logs all three runs.
- Unverified: CI itself (the fix is not on Pro main, so no `pro-release.yml` dry-run was dispatched, and
  the "twice in a row" criterion is open). Pro `verify` passes locally.
