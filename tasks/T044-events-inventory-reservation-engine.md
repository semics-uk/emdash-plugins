---
id: T044
title: "Events: inventory reservation engine"
phase: 2
package: events
edition: free
status: review
model: opus-5.5
size: L
depends_on: [T042, T007]
spec: [EV-FR-04, EV-NFR-03, R3]
---

# T044 · Events: inventory reservation engine

## Definition

Reserve across ticket types, occurrence and event with one `reserved` counter each, guarded by `updateIf`; fixed order, compensation on partial failure, and a drift-repair function.

## Model

**Opus 5.5**: Concurrency correctness.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Property test: 200 parallel reservations against D1 never exceed capacity
- [x] Injected failure between steps leaves counters unchanged after compensation
- [x] Drift repair recomputes `reserved` from live bookings
- [x] Sold-out returns `SOLD_OUT` within budget

## Implementation (green, then refactor)

- `src/domain/inventory.ts`

## Acceptance criteria

- [x] Single module owns all counter writes
- [x] `config/save` (T042, `src/routes/config.ts`) stops rewriting `reserved`/`sold`: counters change only through `updateIf` in `src/domain/inventory.ts`, with a test that a reservation between the read and the write is not lost
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **API** (`src/domain/inventory.ts`): `planReservation` (pure: merges lines, fixed order ticket types by id →
  occurrence → event, answers `SOLD_OUT` from the docs read with zero writes, refuses `TOO_MANY_LINES` when
  `worstCaseCalls(steps) = 2·steps − 1` exceeds the caller's `maxCalls`), `reserve`, `release`, `confirmSold`,
  `countersForBooking`, drift repair (`tallyBookings`, `planDriftRepair`, `applyDriftRepair`,
  `repairEventCounters`), and the `config/save` helpers (`counterlessChanges`, `updateCountedFields`,
  `retireCounted`). The functions never read; callers pass the docs they loaded.
- **Guards:** a step is `updateIf(id, { where: { capacity: <read>, reserved: { lte: capacity − qty } }, delta })`.
  The capacity equality pins the value read, so a concurrent capacity cut cannot oversell. A side effect is that a
  concurrent capacity *raise* makes an in-flight reservation miss (spurious `SOLD_OUT`, rare).
- **`reserved` = held + sold** (BUILD-PLAN 3.1); `sold` is reporting, incremented by `confirmSold`.
- **Ordering contract for T046/T047** (makes drift repair safe at any time): write the booking as `draft` before
  `reserve`, mark it `held` after; call `release` *before* moving a booking to expired/cancelled/refunded. Repair
  then only over-counts briefly, never under-counts. A `draft` counts as live for `DRAFT_GRACE_MS` (5 min).
  Repair reads the counted docs strictly before scanning bookings and writes each fix guarded on the snapshot's
  `reserved`/`sold`, so a counter that moved meanwhile is left alone (`conflicted`, retried next sweep).
- **Budget finding for T046 (important):** with 3 reads (config, occurrence, ticket types `getMany`), the 8-call
  target allows 3 steps (worst case 3 + 5 = 8): one ticket type + occurrence + event, or two ticket types without an
  occurrence. Two ticket types + occurrence + event is 3 + 7 = 10, the hard limit. The reserve route also needs a
  booking put, a rate-limit KV call and Turnstile, so T046 must denormalise reads or defer compensation to the
  sweeper (an over-count is safe) to fit. `planReservation({ maxCalls })` takes whatever budget the route has left.
- **`config/save` changes:** existing docs get `updateIf` of changed non-counter fields only, guarded on
  `reserved ≤ newCapacity` (atomic EV-FR-03; a conflict returns `CAPACITY_BELOW_RESERVED`, or `UNKNOWN_ID` if the
  doc vanished). Dropped docs are retired first (`capacity: 0` guarded on `reserved = 0, sold = 0`), then deleted;
  one that took a seat meanwhile is kept and `ITEM_IN_USE` is returned. New docs are created with `putMany`.
  Unchanged resubmissions write nothing. A save needing more than 8 calls returns `TOO_MANY_CHANGES`
  (new `ConfigIssueCode`) before writing, e.g. editing 6+ existing occurrences at once. T052's admin UI should
  submit only changed items or batch. Writes are staged (edits → deletes → creates), so a write-time refusal
  can follow edits that already applied.
- **Schema:** a merge cannot remove a key, so optional fields cleared on counted docs are stored as `null`.
  The types now allow `| null` and readers must treat `null` as absent.
- **Tests:** unit tests over a fake `updateIf` store (`tests/domain/inventory.test.ts`); D1 tests through a new
  test-only fixture `tests/fixtures/inventory-probe` (vitest project `inventory`, real manifest by symlink). The
  200-request tests run at most 50 in flight so a loaded machine can't push one past the host's 30 s
  per-invocation wall-time limit. All 200 still race. The 4-step property test passes `maxCalls: 7`, inside the
  hard limit of 10.
- Once, under heavy machine load, the T042 test "saves and loads ... within budget" failed the 50 ms CPU ceiling
  on a cold isolate. It passed on rerun, and the call counts were fine. Watch for this in T057.
