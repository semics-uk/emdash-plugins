---
id: T052
title: "Events: Block Kit admin pages, CSV export, dashboard widget"
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: M
depends_on: [T048, T014]
spec: [EV-FR-11, EV-US-5, EV-US-7]
---

# T052 · Events: Block Kit admin pages, CSV export, dashboard widget

## Definition

Bookings and Attendees pages (search, admin check-in by name or code, undo), CSV export (raw `text/csv`) and the sold/capacity widget.

## Model

**Sonnet 5.5**: UI composition.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Pages load and validate
- [ ] Check-in twice shows first check-in time
- [ ] CSV escapes commas and quotes
- [ ] Widget meters match counters

## Implementation (green, then refactor)

- `src/admin/*.ts`, `src/routes/attendees.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Settings page calls `validateMapping` (`src/domain/mapping.ts`) with the `schema:read` collections and renders its `banner`; shows the T040 `encryptionKeyStatus` banner too
- [ ] Admin pages built with the `@semics-tech/shared` Block Kit builders (T014), not raw JSON; banners via `notices([...])`
- [ ] The editor submits only changed items to `config/save` (bulk edits hit `TOO_MANY_CHANGES` beyond 8 calls, T044)
- [ ] Settings page warns when no Turnstile secret is set: checkout then runs without a bot check (T047)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
