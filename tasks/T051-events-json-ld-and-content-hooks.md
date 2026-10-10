---
id: T051
title: "Events: JSON-LD and content hooks"
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T042, T005]
spec: [EV-FR-10, Events hooks]
---

# T051 · Events: JSON-LD and content hooks

## Definition

`page:metadata` emits schema.org `Event` with offers and availability; content hooks sync status and handle deletes per Spike S9.

## Model

**Sonnet 5.5**: Hook wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] JSON-LD validates against schema.org Event fields
- [ ] Unpublish pauses sales
- [ ] Delete with bookings follows the S9 decision

## Implementation (green, then refactor)

- `src/hooks/metadata.ts`, `src/hooks/content.ts`

## Acceptance criteria

- [ ] Runtime host fires hooks with real entries
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
