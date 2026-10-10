---
id: T104
title: "Release automation"
phase: 7
package: repo
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T002, T071]
spec: [BUILD-PLAN §9]
---

# T104 · Release automation

## Definition

`emdash-plugin release setup` workflow wired to Changesets, npm provenance publish, and the Pro release workflow.

## Model

**Sonnet 5.5**: Generated workflows plus wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Dry-run release produces the expected artifacts
- [ ] Workflows lint clean

## Implementation (green, then refactor)

- `.github/workflows/*.yml`

## Acceptance criteria

- [ ] Documented in CONTRIBUTING
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
npx actionlint
```
