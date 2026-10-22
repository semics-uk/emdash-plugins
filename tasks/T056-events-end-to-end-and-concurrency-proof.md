---
id: T056
title: "Events: end-to-end and concurrency proof"
phase: 2
package: events
edition: free
status: review
model: opus-5.5
size: M
depends_on: [T050, T051, T052, T054, T055, T009]
spec: [Phase 2 exit criteria]
---

# T056 · Events: end-to-end and concurrency proof

## Definition

Playwright free-booking journey plus a load test of 100 concurrent checkouts for the last 5 seats against the playground.

## Model

**Opus 5.5**: Concurrency proof needs careful harness design.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Journey: list → book → email (captured) → ICS → cancel
- [x] Load test: exactly 5 bookings succeed, 95 get `SOLD_OUT`
- [x] ICS and email times correct in 3 zones

## Implementation (green, then refactor)

- `apps/playground/e2e/events.spec.ts`, `apps/playground/load/checkout.mjs`

## Acceptance criteria

- [x] Runs in CI
- [x] Booking page handles `?k=` (T050, R34): show an "Open my booking" button that POSTs, call `public/booking/redeem` server-side, set the `semics_booking_<ref>` cookie, redirect to `/booking?ref=` without `k`; never redeem on GET (mail scanners prefetch). Wire `calendar.query` and attendee `code` from `public/booking` into the pass and calendar link (T055)
- [x] `public/events` rows carry the entry slug so `EventCard` links to the event page by default (T054)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```

## Notes

- Files: `apps/playground/e2e/events.spec.ts` (journey, three zones, load), `apps/playground/load/checkout.mjs`
  (also runnable: `node load/checkout.mjs http://127.0.0.1:4401`, exits non-zero unless 5 book / 95 `SOLD_OUT`).
- **Email capture: the delivered message, not the outbox row.** Outbox rows hold ids only and the
  booking link's one-time code is minted when the drain renders and sends (R34), so the row has no
  link to follow. EmDash registers its dev console provider only under `astro dev`, and the e2e
  server is a production build, so the playground gets a tiny trusted `email:deliver` provider
  (`src/e2e/mail-capture.mjs`, in memory) and `GET /e2e/mail?to=` reads it back.
- **Cron:** `POST /e2e/cron?task=outbox-drain` makes the task due and runs one
  `runScheduledTasksWithStats()` batch through `withEmDashRuntime` (the executor's atomic claim makes
  a concurrent timer tick harmless). The drain sends 2 per tick, so the spec ticks until its email arrives.
- **Finding (follow-up needed): EmDash 1.2 never runs `plugin:install`/`plugin:activate` for a
  sandboxed plugin declared in `sandboxed: [...]`** (`installUnrecordedConfigPlugins` covers native
  `plugins` only), so an npm/config install never schedules `sweep-holds` or `outbox-drain`: no
  emails and no hold sweeping until an admin disables and re-enables the plugin. `/e2e/cron`
  activates the core once when the task row is missing. The core should schedule its crons some
  other way (e.g. idempotently from `cron`-less entry points such as checkout/reserve when the
  sweeper is unscheduled, or a documented setup step) or the fix should go upstream.
- **Fixed here: the per-IP reserve limit saw every widget visitor as one "unknown" IP.**
  `callPublicRoute` built a fresh `Request` with no headers, so the site as a whole could take only
  10 bookings per 10 minutes through `/_events/checkout`. It now passes on the visitor's
  client-IP headers (`x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`, `true-client-ip`,
  `fly-client-ip`, and Cloudflare's `cf`), never cookies or credentials; the host still decides
  which to trust (`trustedProxyHeaders` / `EMDASH_TRUSTED_PROXY_HEADERS`). On Cloudflare the `cf`
  object is copied, which extractRequestMeta needs; not exercised locally (T111 staging should confirm).
  The playground trusts `x-forwarded-for` so each spec visitor and each of the 100 buyers has its own IP.
- **Fixed here: the content hooks read the wrong shape.** EmDash passes `content:afterSave` /
  `afterPublish` a content item (`{ id, slug, data: { ...fields } }`); `infoOfEntry` read the
  fields at the top level, so saving an event in the admin never refreshed `info` (tests passed a
  flat record). It now takes either shape and keeps the entry `slug` on `info`.
- `?k=` flow: GET renders only the "Open my booking" form (no cookie read, no core call); the POST
  (`intent=redeem`) calls `redeemBookingLink`, sets the cookie with the same options as checkout
  (`bookingCookieOptions`) and 303s to `/booking?ref=`. A used/expired/wrong code lands on
  `?ref=&error=LINK_INVALID`. The e2e GETs the link twice (scanner) and still redeems it after,
  then shows the second use is refused. `calendar.query` and attendee codes were already wired
  into the page by T055; the journey now proves them against a real booking.
- Slugs: `info.slug` (absent on copies made before this change until the entry is saved again);
  `public/events` rows carry `slug`; `<EventList>` defaults to `/events/<slug>` (`eventHref`),
  `hrefFor` still overrides and may return `undefined` for plain titles.
- Shared harness edits (small, additive): `playwright.config.ts` env, `astro.config.mjs` adds
  `mailCapture()`, `fixtures.mjs` writes `info.slug`, `seed/events-fixture.json` gives
  nyc-workshop a free "Standby (free)" type (Free can't confirm paid bookings, and the zone test
  needs a New York email).
- CI: the Playwright job ran `pnpm exec playwright test` at the root, which has no config; it now
  runs `pnpm --filter playground e2e` (system Chrome, no browser download).
- Evidence: unit tests 11 red (missing `redeemBookingLink`/`eventHref`, no slug, nested content
  ignored, IP headers dropped), then green. E2E red with the implementation reverted: no card link,
  no "Open my booking" button (emails were captured and their zone times already matched), no slug
  for the load script; green after: 5/5 in 8 s; full suite 53 passed.

