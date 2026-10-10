---
id: T010
title: "Shared: result type, stable error codes, route error mapping"
phase: 1
package: shared
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T003]
spec: [BUILD-PLAN §4 result.ts]
---

# T010 · Shared: result type, stable error codes, route error mapping

## Definition

A typed `Result` and a registry of stable error codes (`HOLD_EXPIRED`, `SOLD_OUT`, `TOKEN_INVALID`, …) with mapping to HTTP status and user-safe messages.

## Model

**Sonnet 5.5**: Plain typed module.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Each error code maps to exactly one status and message
- [ ] Unknown errors map to 500 without leaking the message
- [ ] Codes are unique (test enumerates the registry)

## Implementation (green, then refactor)

- `packages/shared/src/result.ts`

## Acceptance criteria

- [ ] Used by both cores' route handlers
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
