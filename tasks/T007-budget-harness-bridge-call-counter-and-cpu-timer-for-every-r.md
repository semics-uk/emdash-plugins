---
id: T007
title: "Budget harness: bridge-call counter and CPU timer for every route test"
phase: 0
package: shared
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T003]
spec: [EV-NFR-01, EV-NFR-02, ES-NFR-01, Spike S1 (local proxy)]
---

# T007 · Budget harness: bridge-call counter and CPU timer for every route test

## Definition

A test utility that wraps the plugin test hosts, counts bridge calls (storage, kv, content, http, email) and CPU time per invocation, and lets each test assert `≤ 10 calls` and a CPU ceiling. Until Cloudflare staging exists (T110), this is the enforcement for the platform limits.

## Model

**Opus 5.5**: Has to hook into the test hosts' bridge without breaking isolation; subtle instrumentation.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Counter reports exactly N calls for a fixture route that makes N storage gets
- [ ] `expectWithinBudget(result, { calls: 10 })` fails with a readable diff when a route makes 11 calls
- [ ] CPU timer reports a stable figure (±20%) across 5 runs of a fixed workload

## Implementation (green, then refactor)

- `packages/shared/testing/budget.ts` (test-only export), documented in `tasks/README.md`
- Adopted by the scaffold tests in both cores

## Acceptance criteria

- [ ] Every later route task asserts its budget with this helper
- [ ] Readable failure output names the calls made
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
pnpm --filter @semics-tech/emdash-events verify
```
