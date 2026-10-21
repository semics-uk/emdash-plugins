---
id: T046
title: "Events: public event listing routes"
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T042]
spec: [EV-FR-03, Events public routes]
---

# T046 · Events: public event listing routes

## Definition

`public/events` (cached 60 s) and `public/event` with ticket availability and price display.

## Model

**Sonnet 5.5**: Read routes.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Unpublished events are absent
- [ ] Cache-Control header set
- [ ] Availability reflects reserved counters
- [ ] Within budget

## Implementation (green, then refactor)

- `src/routes/public-events.ts`

## Acceptance criteria

- [ ] No private fields in responses
- [ ] `public/event` takes `GET { eventId }` and answers in the `PublicEvent` shape in `src/astro/lib/widget.ts` (T055); then drop the playground event page's fixture `data` prop
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
