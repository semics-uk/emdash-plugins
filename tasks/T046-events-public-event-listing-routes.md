---
id: T046
title: "Events: public event listing routes"
phase: 2
package: events
edition: free
status: review
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

- [x] Unpublished events are absent
- [x] Cache-Control header set
- [x] Availability reflects reserved counters
- [x] Within budget

## Implementation (green, then refactor)

- `src/routes/public-events.ts`

## Acceptance criteria

- [x] No private fields in responses
- [x] `public/event` takes `GET { eventId }` and answers in the `PublicEvent` shape in `src/astro/lib/widget.ts` (T055); then drop the playground event page's fixture `data` prop
- [x] **Bug from T050:** emails and calendar files read fixed snake_case fields; read them through the T041 mapping settings (`fieldStartsAt`, `fieldEndsAt`, `fieldTimezone`, `fieldVenue`) in one shared helper used by T046, T050 and T051
- [x] Denormalise the event's public info (title, times, zone, venue) onto the event config when content changes, so the outbox drain (T050: one email per tick at 8 calls) can send several per tick
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- `public/events` is one `event_configs.query` (non-draft, non-orphaned, upcoming; a recurring event shows its next open date). `public/event` is 4 calls (config, ticket types, occurrences if recurring, settings for the Turnstile site key). Both answer `available` only; draft, orphaned, unknown and malformed ids give the same `NOT_FOUND`.
- One shared helper, `src/domain/event-info.ts` (`mappingOf`, `infoOfEntry`, `loadEventInfo`), reads the T041 mapping settings (`eventsCollection`, `fieldStartsAt`, `fieldEndsAt`, `fieldTimezone`, `fieldVenue`). Emails and calendar files (T050/T051) use it; its settings dependency is now `settings.list()` (1 call, was `get`).
- The public info is copied onto the event config as `info` by `content:afterSave` (`src/content-hooks.ts`, 2 calls) and by `config/save` when it creates the config (+2 reads, first save only). `info` is a managed field like `catalog` (admin edits never diff it; `config/get` and the editor hide it). A config without `info` (saved before this task) is read from the entry as a fallback, then healed by the next entry save (content:afterSave); such events are not in the listing until then.
- Outbox drain: `OUTBOX_PER_TICK` 1 -> 2. A per-tick `prefetch` reads bookings, attendees, configs and occurrences with one `getMany`/`in` query each: two confirmations are 9 calls (10 with occurrences), two cancellations 6-7, an empty tick 1. Asserted in `tests/emails/outbox.test.ts`. A legacy config without `info` adds 2 calls per event on its first tick (can exceed 10 once).
- Not done: `content:afterUnpublish`/`afterDelete` do not touch `info`; unpublishing the entry keeps the event listed while its config is on sale (pause or draft the config). Playground: the event page no longer passes `data`; `src/utils/booking-fixture.ts` is gone; the e2e harness fixture now also writes `info`. Playground e2e ran once: 30 passed, 1 skipped (pre-existing).
