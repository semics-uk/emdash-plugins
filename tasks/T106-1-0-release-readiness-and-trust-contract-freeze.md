---
id: T106
title: "1.0 release readiness and trust-contract freeze"
phase: 7
package: repo
edition: free
status: backlog
model: opus-5.5
size: S
depends_on: [T100, T101, T102, T103, T104, T105]
spec: [Phase 7 exit]
---

# T106 · 1.0 release readiness and trust-contract freeze

## Definition

Freeze both trust contracts, run every gate, confirm the PRD feature checklists, cut 1.0 release candidates.

## Model

**Opus 5.5**: Final judgement call.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Every PRD requirement maps to a passing test (traceability report)
- [ ] Trust-contract snapshot test added

## Implementation (green, then refactor)

- `scripts/traceability.mjs`

## Acceptance criteria

- [ ] Release candidates built
- [ ] The scaffold `hello` route is removed from the Events core before the route list freezes (T057 review F14)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```
