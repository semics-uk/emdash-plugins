---
id: T053
title: "Events UI: integration, call helper and booking page route"
phase: 2
package: events
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T004, T006]
spec: [EU-FR-01, EU-FR-05, EU-FR-06]
---

# T053 · Events UI: integration, call helper and booking page route

## Definition

Finish the `./integration` entry: inject the checkout endpoint (`/_events/checkout`) for no-JS posts and the `/booking` page with `Referrer-Policy: no-referrer`.

## Model

**Sonnet 5.5**: Follows the established pattern.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Plain form post to the endpoint redirects to the booking page
- [x] Header assertion on `/booking`
- [x] Token never appears in a plugin route URL (request log)

## Implementation (green, then refactor)

- `src/integration/index.ts`

## Acceptance criteria

- [x] Uses the T004 helper only
- [x] The core's plugin ID is never hard-coded: it's a descriptor option (default the slug for npm installs) and the docs explain that registry installs use the `r_…` ID (S7, T005)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```

## Notes

- `eventsIntegration({ pluginId })` (`@semics-tech/emdash-events/integration`) injects `POST /_events/checkout` and `/booking`. `pluginId` defaults to `semics-events`; registry installs must pass their `r_…` id (used by the endpoint and booking page via a virtual module). `eventsUi()` is unchanged.
- Token handling: the endpoint sets an HttpOnly, SameSite=Lax cookie `semics_booking_<ref>` (Path `/booking`) and 303-redirects to `/booking?ref=<ref>`; the page reads the cookie and sends `{ bookingRef, accessToken }` in POST bodies. Errors redirect to `/booking?error=<CODE>`. A paid booking redirects to the continue step's payment url.
- UI build output moved from `dist/ui` to `dist/ts` (adds `src/integration`); `./ui` export updated; `allowImportingTsExtensions` added to tsconfig.
- Cancel is a no-JS form POST to `/booking`, with no CSRF token beyond the SameSite=Lax cookie; a reviewer may want an Origin check.
- Follow-up: a happy-path e2e (real booking) needs a seeded event config; covered now by unit tests with a fake handler.
