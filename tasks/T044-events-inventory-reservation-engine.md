---
id: T044
title: "Events: inventory reservation engine"
phase: 2
package: events
edition: free
status: backlog
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

- [ ] Property test: 200 parallel reservations against D1 never exceed capacity
- [ ] Injected failure between steps leaves counters unchanged after compensation
- [ ] Drift repair recomputes `reserved` from live bookings
- [ ] Sold-out returns `SOLD_OUT` within budget

## Implementation (green, then refactor)

- `src/domain/inventory.ts`

## Acceptance criteria

- [ ] Single module owns all counter writes
- [ ] `config/save` (T042, `src/routes/config.ts`) stops rewriting `reserved`/`sold`: counters change only through `updateIf` in `src/domain/inventory.ts`, with a test that a reservation between the read and the write is not lost
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
