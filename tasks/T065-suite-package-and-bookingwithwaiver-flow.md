---
id: T065
title: "Suite: package and BookingWithWaiver flow"
phase: 3
package: suite
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T062, T064, T055, T030]
spec: [SX-FR-01, SX-FR-02, SX-FR-03]
---

# T065 · Suite: package and BookingWithWaiver flow

## Definition

Create `@semics-tech/emdash-events-suite`: `eventsSuite()` config helper and `<BookingWithWaiver>` running reserve → inline signing → receipt → done.

## Model

**Opus 5.5**: Cross-package orchestration.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] `eventsSuite()` returns the expected sandboxed and plugins arrays
- [ ] Playwright: waiver booking completes in one page flow
- [ ] Payment step slot exists for Phase 4

## Implementation (green, then refactor)

- `packages/events-suite/`

## Acceptance criteria

- [ ] No business logic in the suite
- [ ] `eventsSuite()` passes each core's plugin ID to both UI entries and the pairing glue; no hard-coded slugs (S7, T005)
- [ ] The suite's `from-intent` caller treats an email intent's `draft` answer like `sent` (T062/T063); the booking widget gets an "under 18" control per attendee for waiver events; attendee names are checked for C0 control characters before intents are issued (e-sign refuses them)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events-suite verify
pnpm --filter playground e2e
```
