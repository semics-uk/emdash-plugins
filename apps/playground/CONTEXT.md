# Playground context

Astro 7 + EmDash 1.2.0 on Node, workerd sandbox runner, loading the events core sandboxed and the events
UI natively (`astro.config.mjs`). Used for end-to-end tests only.

- `corepack pnpm@10.23.0 --filter playground e2e`: builds the events package and the site, deletes
  `data.db*` and `uploads/`, seeds with `emdash seed` (`seed/seed.json`), serves on port 4401, runs
  Playwright with the system Chrome. `E2E_SKIP_BUILD=1` skips the build. About 40 s unloaded.
- **One playground server at a time**: workerd always binds ports from 18788. Stop every server and
  `workerd` you start.
- Seed: `events` collection with snake_case fields (`starts_at`, `ends_at`, `timezone`, `venue`,
  `image`, `summary`, `body`); four sample events; page `whats-on` with an `events-list` block.
- Booking fixtures: `e2e/harness/fixtures.mjs` writes `seed/events-fixture.json` (london-meetup on
  sale, free tickets, plus the entry's `info`) into `_plugin_storage` after seeding; `/events/[slug]`
  renders `<BookingWidget event>`, which loads `public/event` itself (T046). `/e2e/widgets` shows components in states the
  site can't reach yet (Turnstile on, a pass, a signed calendar link). axe via `@axe-core/playwright`.
- Specs: `e2e/smoke`, `e2e/harness`, `e2e/s2-public-route` (success test skipped until T054 points it at
  `public/events`), `e2e/s6-pt-block`, `e2e/t053-booking-page`, `e2e/t055-booking-widget`.
- E-sign journey (T033): `e2e/harness/esign-admin.mjs` seeds one admin user + API token (no sign-in bypass in a
  production build); `e2e/harness/esign-journey.ts` drives the real private/public routes (template, envelope with a
  signer-fillable field, send, sign, wait for the signed PDF, `/signed/<token>` from the completion email).
  Tokens are read from the clear-text outbox rows (`invite-<envelopeId>:s1`, `complete-<envelopeId>`) before the
  one-minute drain scrubs them. The PDF job is a one-shot cron: it runs within a second or two, so tests poll the
  admin receipt (`envelopes/get`) rather than waiting for the minute tick. `esign.spec.ts` is the journey;
  `t032-verify-page.spec.ts` signs its own envelope in `beforeAll`.
- Fixtures cover london-meetup, nyc-workshop and sydney-conference (on sale; the past gala has no config so it is
  not listed). `/whats-on` holds an `events-list` and an `events-booking` block; `/e2e/lists?view=live|empty|card`
  shows the list and card (`theme=dark` for the second snapshot theme); `/spike/s2` reads `public/events`.
- Specs: `e2e/smoke`, `e2e/harness`, `e2e/s2-public-route`, `e2e/s6-pt-block`, `e2e/t053-booking-page`,
  `e2e/t054-events-list` (card snapshots in `e2e/__snapshots__/`, one per theme, shared by every OS: regenerate
  with `--update-snapshots` if the CI font differs), `e2e/t055-booking-widget`.
