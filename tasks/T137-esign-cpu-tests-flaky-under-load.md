---
id: T137
title: "E-sign: CPU-budget tests flaky under a full local verify"
phase: 7
package: esign
edition: free
status: in-progress
model: sonnet-5.5
size: S
depends_on: []
spec: [R92]
---

# T137 · E-sign: CPU tests flaky under load

## Definition

`download.routes` and `from-intent.routes` CPU-budget tests failed at 58-60 ms against 50 ms in a full
local `pnpm verify` while other work ran (T132), and passed alone. CPU budgets are meant to warn (≤ 4x)
on a busy machine and stay strict on CI (orchestrator lessons, R92). Find why these two failed instead
of warning (load detection, the measured section including setup, warm-up), and either make the
measurement robust or reduce the work measured. CI strictness must stay.

## Acceptance criteria

- [ ] Root cause in Notes; fix test-first where it is code
- [ ] Ten full-suite runs of the esign package under an artificial CPU load pass (warnings allowed), and the tests still fail on an artificially slowed hook
- [ ] Meets the Definition of Done
