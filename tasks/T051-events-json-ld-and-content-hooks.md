---
id: T051
title: "Events: JSON-LD and content hooks"
phase: 2
package: events
edition: free
status: review
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

- [x] JSON-LD validates against schema.org Event fields
- [x] Unpublish pauses sales
- [x] Delete with bookings follows the S9 decision

## Implementation (green, then refactor)

- `src/hooks/metadata.ts`, `src/hooks/content.ts`

## Acceptance criteria

- [x] Runtime host fires hooks with real entries
- [x] `content:beforeDelete` returns exactly `false` to veto (not `{ cancel: true }`); `afterDelete` orphan banner covers permanent deletes (S9, T005)
- [x] **From T046 review:** `content:afterUnpublish` and `content:afterDelete` remove the event from `public/events` (clear or flag `info`), so an unpublished entry is never listed publicly
- [x] **From T046 review:** the outbox drain must never exceed 10 calls: when a row's config has no `info` (fallback to the entry, +2 calls), send only that one message in the tick; assert the worst case
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- `src/content-hooks.ts` moved to `src/hooks/content.ts` (afterSave unchanged); JSON-LD is `src/hooks/metadata.ts`.
- Unpublish sets a new `unpublished` flag on the event config instead of changing `status` (so republishing
  needs no memory of the old status). Reserve, `public/events`, `public/event` and the JSON-LD treat it like
  `orphaned`; `config/save` and the diff skip it (managed field). `info` is kept, so no data is lost.
- The host runs `afterPublish`/`afterUnpublish` in the background (`runDeferredContentHook`); runtime tests use `vi.waitFor`.
- `beforeDelete` vetoes while a booking is `held`, `awaiting_signature`, `awaiting_payment` or `confirmed`.
- Outbox: when any prefetched config lacks `info`, the batch is cut to 1 message (worst case 10 calls, with
  occurrences too); the other row stays pending for the next tick. `remainingHint` is then false (one row read).
- JSON-LD: `<` becomes the full-width sign in strings (the host also escapes `<` when printing). Per-offer
  availability: InStock, SoldOut (type or event full), PreOrder (sales not open), Discontinued (not on sale).
- Manifest unchanged: no new capability or hook declaration needed (`content:read` already covers the veto).
