---
id: T018
title: "Shared: money, time zones and calendar files"
phase: 2
package: shared
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T003]
spec: [EV-NFR-08, EV-FR-09]
---

# T018 · Shared: money, time zones and calendar files

## Definition

Minor-unit money formatting, IANA time zone conversion via `Intl`, and RFC 5545 `.ics` generation.

## Model

**Sonnet 5.5**: Standard formats with known edge cases.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Formatting for GBP, USD, EUR, JPY (zero-decimal)
- [ ] UTC ↔ zone conversion across a DST change in 3 zones
- [ ] ICS output validates against RFC 5545 rules (line folding, escaping, DTSTART with TZID)

## Implementation (green, then refactor)

- `packages/shared/src/money.ts`, `time.ts`, `ics.ts`

## Acceptance criteria

- [ ] Snapshot ICS files checked into tests
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
