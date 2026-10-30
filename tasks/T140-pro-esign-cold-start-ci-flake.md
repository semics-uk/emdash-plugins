---
id: T140
title: "Pro E-sign: cold-start CPU budget flaked on CI (52.7 ms against 50)"
phase: 7
package: esign
edition: pro
status: backlog
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

- [ ] Cause named: real headroom shortfall, or the hung `pro/licence` request inflating the measure.
- [ ] If headroom: the Pro E-sign cold start is under 45 ms on CI (10% room), budget unchanged at 50.
- [ ] If the hung request: no uncaught "Route not found: pro/licence" in the Pro test logs.
- [ ] `gh workflow run pro-release.yml -f public-ref=main -f dry-run=true` passes twice in a row.
