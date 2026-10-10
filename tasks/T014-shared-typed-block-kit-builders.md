---
id: T014
title: "Shared: typed Block Kit builders"
phase: 1
package: shared
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T003]
spec: [RESEARCH §3.8]
---

# T014 · Shared: typed Block Kit builders

## Definition

Typed helpers for the Block Kit blocks and elements both admins use (table, stats, form, repeater, banner, tabs, chart), validated against the host's Block Kit validator.

## Model

**Sonnet 5.5**: Typed wrappers around a documented schema.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Each builder's output passes the runtime host's Block Kit validation
- [ ] Snapshot tests for a sample page per block type

## Implementation (green, then refactor)

- `packages/shared/src/blockkit.ts`

## Acceptance criteria

- [ ] Admin tasks use builders, not raw JSON
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
