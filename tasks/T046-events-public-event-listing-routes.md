---
id: T046
title: "Events: public event listing routes"
phase: 2
package: events
edition: free
status: in-progress
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
- [ ] **Bug from T050:** emails and calendar files read fixed snake_case fields; read them through the T041 mapping settings (`fieldStartsAt`, `fieldEndsAt`, `fieldTimezone`, `fieldVenue`) in one shared helper used by T046, T050 and T051
- [ ] Denormalise the event's public info (title, times, zone, venue) onto the event config when content changes, so the outbox drain (T050: one email per tick at 8 calls) can send several per tick
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
