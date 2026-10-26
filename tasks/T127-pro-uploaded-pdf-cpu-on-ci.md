---
id: T127
title: "E-sign Pro: near-limit uploaded PDF inside the CPU budget on CI"
phase: 6
package: esign
edition: pro
status: in-progress
model: opus-5.5
size: S
depends_on: [T125]
spec: [R53, R92]
---

# T127 · E-sign Pro: near-limit uploaded PDF inside the CPU budget on CI

## Definition

The first real Pro build on GitHub (pro-release.yml dry run, run 40325534223 in semics-uk/emdash-plugins-pro)
fails one test of 192: `packages/esign-pro/tests/pdf-templates.editions.test.ts` "S5 R53 a near-limit PDF
renders in one invocation within the bridge-call and CPU budgets", `hook "cron" used CPU 57.0 ms (limit 50
ms)`. This is the open R53 check from T111. Measure where the time goes on a GitHub runner (as T125 did,
with a throwaway workflow in the Pro repo), then make the cron fit 50 ms on CI for the largest uploaded PDF
it accepts, by cheaper code or, failing that, a measured, recorded lower upload limit (R row) refused with a
clear error at upload. Pro CI only runs in pro-release.yml (dry run by default, so safe to dispatch).

## Acceptance criteria

- [ ] Cause recorded with CI numbers in this file
- [ ] Test first, then the fix; budgets stay strict on CI
- [ ] A pro-release.yml dry run (dry-run=true) is green end to end; run id recorded; T111's R53 criterion ticked if this proves it
- [ ] Meets the Definition of Done
