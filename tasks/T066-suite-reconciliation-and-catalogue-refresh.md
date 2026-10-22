---
id: T066
title: "Suite: reconciliation and catalogue refresh"
phase: 3
package: suite
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T065]
spec: [SX-FR-05, SX-FR-07]
---

# T066 · Suite: reconciliation and catalogue refresh

## Definition

`<BookingStatus>` fetches missing receipts and forwards them; the Events panel's Refresh templates calls the catalogue.

## Model

**Sonnet 5.5**: Wiring with clear tests.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Closed-tab scenario reconciles on status page load
- [ ] Forwarding twice changes nothing
- [ ] Catalogue refresh populates the select

## Implementation (green, then refactor)

- `packages/events-suite/src/reconcile.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] If e-sign refuses an intent mid-flow, offer a retry instead of leaving the booking held (T065); `public/event` says whether a waiver is required so `<BookingWithWaiver>` shows attendee rows only when needed
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events-suite verify
pnpm --filter playground e2e
```
