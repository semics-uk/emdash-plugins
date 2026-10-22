---
id: T054
title: "Events UI: event list, card and block"
phase: 2
package: events
edition: free
status: done
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

- [x] Renders events in their own time zones
- [x] Empty state renders
- [x] Visual snapshot in 2 themes

## Implementation (green, then refactor)

- `src/astro/EventList.astro`, `EventCard.astro`, `styles/`

## Acceptance criteria

- [x] No client JS
- [x] `EventList.astro` replaces T006's static placeholder data with `callPublicRoute` to `public/events`; the S2 skipped e2e test is re-enabled against that route
- [x] Seed an event config (tickets, capacity) so the e2e can make a real booking through `POST /_events/checkout` → `/booking` (T053 covers only error paths end to end)
- [x] The `events-booking` Portable Text block (BUILD-PLAN §3.3) renders `BookingWidget` (T055 did not add it)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```

## Notes

- `EventList` takes an optional `events` prop (skips the route) and `hrefFor`; `public/events` carries no slug, so cards are not linked by default. A later task could add the entry slug to the listing.
- The booking path already existed (T055 e2e books through `POST /_events/checkout` to `/booking`); T054 added fixtures for the NYC and Sydney events (so the list shows three zones), a booking through the `events-booking` block on `/whats-on`, and repointed the S2 test at `public/events`.
- Astro components import `formatInZone`/`isValidTimeZone` from `@semics-tech/shared`, a private source-only workspace package that is a devDependency of events. It works in the workspace; before the UI is published, shared must be inlined or published (follow-up for the publish task).
- Styles are scoped `<style>` blocks in each component (`--events-*` variables), not a separate `styles/` folder.
- Snapshots are macOS Chrome baselines (3% pixel tolerance, system UI font); CI on Linux may need `--update-snapshots` once.
