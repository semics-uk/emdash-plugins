---
id: T034
title: "Phase 1 gate: review and budgets"
phase: 1
package: esign
edition: free
status: backlog
model: opus-5.5
size: S
depends_on: [T033]
spec: [Phase 1 exit, ES-NFR-*]
---

# T034 · Phase 1 gate: review and budgets

## Definition

Adversarial review of the e-sign core and UI: security of public routes, budgets on every route, coverage, and PRD conformance. Fix or file issues before Phase 2 depends on shared modules.

## Model

**Opus 5.5**: Judgement-heavy review.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Review checklist executed and recorded in `tasks/reviews/phase-1.md`
- [ ] Every public route has a budget assertion

## Implementation (green, then refactor)

- Run the code-review skill over the phase diff

## Acceptance criteria

- [ ] No open Severity 1 or 2 findings
- [ ] Route errors set the HTTP status from `toRouteError().status` (T021/T022 return the error body with 200)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```
