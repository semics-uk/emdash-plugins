---
id: T067
title: "Phase 3 gate: integration security and E2E"
phase: 3
package: suite
edition: free
status: backlog
model: opus-5.5
size: S
depends_on: [T066]
spec: [Phase 3 exit, SX-NFR-*]
---

# T067 · Phase 3 gate: integration security and E2E

## Definition

Run every protocol vector against both deployed cores, forgery and replay attacks, open-redirect tests; review recorded.

## Model

**Opus 5.5**: Security judgement.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Waiver-required booking can't confirm without receipts
- [ ] All attack tests fail safely

## Implementation (green, then refactor)

- `apps/playground/e2e/waiver.spec.ts`, `tasks/reviews/phase-3.md`

## Acceptance criteria

- [ ] No open Severity 1 or 2
- [ ] Declined/expired receipts are re-forwarded on every status-page load while the booking waits (T066): stop asking once a ref has a terminal receipt recorded
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
pnpm verify
```
