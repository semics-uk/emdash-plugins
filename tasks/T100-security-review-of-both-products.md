---
id: T100
title: "Security review of both products"
phase: 7
package: repo
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T078, T087, T097]
spec: [Phase 7, Management plan: Security]
---

# T100 · Security review of both products

## Definition

Full review: public routes, token entropy, rate limits, CSRF assumptions, XSS, licence code, dependency audit; fixes land with tests.

## Model

**Opus 5.5**: Security judgement.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Every finding has a regression test
- [ ] `pnpm audit` clean or justified

## Implementation (green, then refactor)

- `tasks/reviews/security-1.0.md`

## Acceptance criteria

- [ ] No open Severity 1 or 2
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```
