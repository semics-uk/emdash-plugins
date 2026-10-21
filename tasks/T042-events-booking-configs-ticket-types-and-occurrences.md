---
id: T042
title: "Events: booking configs, ticket types and occurrences"
phase: 2
package: events
edition: free
status: done
model: sonnet-5.5
size: M
depends_on: [T041, T018]
spec: [EV-FR-02, EV-FR-03]
---

# T042 · Events: booking configs, ticket types and occurrences

## Definition

Per-entry `eventConfigs`, `ticketTypes` and single/multi-day `occurrences` with private config routes and validation.

## Model

**Sonnet 5.5**: CRUD with validation.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Save and load round-trip
- [x] Invalid prices, capacities and sale windows are rejected with codes
- [x] Capacity can't be lowered below `reserved`
- [x] Routes within budget

## Implementation (green, then refactor)

- `src/domain/config.ts`, `src/routes/config.ts`

## Acceptance criteria

- [x] Pure validation functions
- [x] Every route and cron job in this task asserts its budget with `withBudget(host)` + `expectWithinBudget` from `@semics-tech/shared/testing` (T007); this is the first adopter in its package, so also wire the harness into the package test setup
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- Routes are private `config/get` and `config/save` (`src/routes/config.ts`); validation is pure in `src/domain/config.ts`. Both routes assert the T007 budget (save is at most 8 bridge calls).
- Rejections return the shared `BAD_REQUEST` body plus `issues: [{path, code}]`. The field codes (INVALID_PRICE, CAPACITY_BELOW_RESERVED, ...) are local to events because `packages/shared` is owned by another task; promote them to the registry if wanted.
- Follow-up for the inventory task: `config/save` rewrites `reserved`/`sold` using values read moments earlier, so a concurrent checkout in that window can be lost. Counter writes should move to `updateIf` in `src/domain/inventory.ts`; save should then leave counters untouched.
- Limits: 25 ticket types and 100 occurrences per event (query page size 100).
- Changeset added: `.changeset/events-booking-config.md`.
