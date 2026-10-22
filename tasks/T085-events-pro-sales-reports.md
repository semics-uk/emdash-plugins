---
id: T085
title: "Events Pro: sales reports"
phase: 5
package: events
edition: pro
status: backlog
model: sonnet-5.5
size: S
depends_on: [T057]
spec: [EV-FR-19]
---

# T085 · Events Pro: sales reports

## Definition

30-day sales chart and revenue by ticket type in Block Kit charts.

## Model

**Sonnet 5.5**: Aggregation and charts.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Aggregates match fixture bookings
- [ ] Chart block validates

## Implementation (green, then refactor)

- `src/admin/reports.ts`

## Acceptance criteria

- [ ] Counters precomputed, not scanned
- [ ] Full attendee export that walks the 100-row CSV parts (T052 offers one part per page)
- [ ] Reports do not treat the `sold` counter as exact: drift repair can over-count it briefly between continue's confirm and `confirmSold` (T057 review F15); revenue and sold figures come from confirmed bookings or are labelled approximate
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
