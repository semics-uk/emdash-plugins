---
id: T076
title: "Events Pro: promo codes and hidden tickets"
phase: 4
package: events
edition: pro
status: backlog
model: sonnet-5.5
size: S
depends_on: [T073]
spec: [EV-FR-14]
---

# T076 · Events Pro: promo codes and hidden tickets

## Definition

Percent, fixed and unlock codes with usage limits and validity windows; unlock reveals hidden ticket types.

## Model

**Sonnet 5.5**: Contained domain logic.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Discounts calculate in minor units without rounding drift
- [ ] Usage limit enforced under concurrency (updateIf)
- [ ] Hidden tickets only appear with a valid unlock code

## Implementation (green, then refactor)

- `src/domain/promo.ts`

## Acceptance criteria

- [ ] Admin page
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
