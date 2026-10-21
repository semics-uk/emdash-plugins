---
id: T041
title: "Events: collection mapping and schema validation"
phase: 2
package: events
edition: free
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T040]
spec: [EV-FR-01, EV-US-1]
---

# T041 · Events: collection mapping and schema validation

## Definition

Settings map the events collection and its fields; `schema:read` validation produces an admin banner when broken.

## Model

**Sonnet 5.5**: Validation logic.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Valid mapping passes
- [ ] Missing field produces a named banner message
- [ ] Mapping to a non-existent collection fails

## Implementation (green, then refactor)

- `src/domain/mapping.ts`

## Acceptance criteria

- [ ] Banner text tested
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
