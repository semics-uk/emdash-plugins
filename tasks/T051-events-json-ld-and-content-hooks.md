---
id: T051
title: "Events: JSON-LD and content hooks"
phase: 2
package: events
edition: free
status: in-progress
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
- [ ] `content:beforeDelete` returns exactly `false` to veto (not `{ cancel: true }`); `afterDelete` orphan banner covers permanent deletes (S9, T005)
- [ ] **From T046 review:** `content:afterUnpublish` and `content:afterDelete` remove the event from `public/events` (clear or flag `info`), so an unpublished entry is never listed publicly
- [ ] **From T046 review:** the outbox drain must never exceed 10 calls: when a row's config has no `info` (fallback to the entry, +2 calls), send only that one message in the tick; assert the worst case
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
