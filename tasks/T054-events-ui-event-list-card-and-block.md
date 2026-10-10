---
id: T054
title: "Events UI: event list, card and block"
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T053, T046]
spec: [EU-FR-03, EU-US-4]
---

# T054 · Events UI: event list, card and block

## Definition

`<EventList>`, `<EventCard>` and the `events-list` block with `--events-*` theming.

## Model

**Sonnet 5.5**: Presentational components.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Renders events in their own time zones
- [ ] Empty state renders
- [ ] Visual snapshot in 2 themes

## Implementation (green, then refactor)

- `src/astro/EventList.astro`, `EventCard.astro`, `styles/`

## Acceptance criteria

- [ ] No client JS
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```
