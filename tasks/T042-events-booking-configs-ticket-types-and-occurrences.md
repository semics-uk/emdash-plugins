---
id: T042
title: "Events: booking configs, ticket types and occurrences"
phase: 2
package: events
edition: free
status: backlog
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

- [ ] Save and load round-trip
- [ ] Invalid prices, capacities and sale windows are rejected with codes
- [ ] Capacity can't be lowered below `reserved`
- [ ] Routes within budget

## Implementation (green, then refactor)

- `src/domain/config.ts`, `src/routes/config.ts`

## Acceptance criteria

- [ ] Pure validation functions
- [ ] Every route and cron job in this task asserts its budget with `withBudget(host)` + `expectWithinBudget` from `@semics-tech/shared/testing` (T007); this is the first adopter in its package, so also wire the harness into the package test setup
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
