---
id: T043
title: "Events: editor panel "Tickets & booking""
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: M
depends_on: [T042, T014]
spec: [EV-US-1, BUILD-PLAN §3.1 Admin]
---

# T043 · Events: editor panel "Tickets & booking"

## Definition

Block Kit editor panel on saved event entries: sale status, ticket-type repeater, capacity, live stats.

## Model

**Sonnet 5.5**: UI composition.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Runtime host `captureEditorDraft`/panel load renders
- [ ] Saving the panel persists config
- [ ] Stats show reserved/sold

## Implementation (green, then refactor)

- `src/admin/panel.ts`

## Acceptance criteria

- [ ] Collections scope set
- [ ] Occurrence (date) editing: the admin Event editor (T052) passes occurrences through unchanged; the editor panel owns adding, editing and removing them via `config/save`
- [ ] Show event titles where events are listed (T052 lists by id; titles need `content:read`, so read them in one batch per page)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
