---
id: T101
title: "Accessibility audit and fixes"
phase: 7
package: repo
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T078, T093]
spec: [EU-NFR-01, SU-NFR-03]
---

# T101 · Accessibility audit and fixes

## Definition

axe and Lighthouse across every public page; keyboard and screen-reader pass; fixes with tests.

## Model

**Sonnet 5.5**: Checklist-driven.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Lighthouse accessibility ≥ 95 on each page
- [ ] No serious axe violations

## Implementation (green, then refactor)

- E2E a11y suite

## Acceptance criteria

- [ ] Recorded results
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```
