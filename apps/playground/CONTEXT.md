# Playground context

Astro 7 + EmDash 1.2.0 on Node, workerd sandbox runner. `astro.config.mjs` is wired by the suite (T065):
`eventsSuite()` gives the Free events and e-sign cores (sandboxed), both UI kits and all integrations
(events, e-sign and the suite's `/_events/waiver`). Never Pro code. Used for end-to-end tests only.
`e2e/harness/build.mjs` builds events, e-sign and the suite before the site.

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
  Tokens are read from the delivered emails (`/e2e/mail?to=`, T061): each envelope gets a unique signer address and
  the harness runs `/e2e/cron?task=outbox-drain&plugin=semics-esign` until the invitation / completion email arrives
  (the drain scrubs the outbox rows, R32). The PDF job is a one-shot cron: it runs within a second or two, so tests poll the
  admin receipt (`envelopes/get`) rather than waiting for the minute tick. `esign.spec.ts` is the journey;
  `t032-verify-page.spec.ts` signs its own envelope in `beforeAll`.
- Fixtures cover london-meetup, nyc-workshop and sydney-conference (on sale; the past gala has no config so it is
  not listed). `/whats-on` holds an `events-list` and an `events-booking` block; `/e2e/lists?view=live|empty|card`
  shows the list and card (`theme=dark` for the second snapshot theme); `/spike/s2` reads `public/events`.
- Emails and cron (T056): `src/e2e/mail-capture.mjs` is the site's email provider (production builds have no dev console
  provider); `GET /e2e/mail?to=` reads delivered messages. `POST /e2e/cron?task=outbox-drain` makes the task due and runs one
  scheduled batch. The cores schedule their own crons (T116: the first public read queues `ensure-schedules`); when the
  row is still missing the endpoint runs one batch first. It never activates the core.
  The server trusts `X-Forwarded-For` (playwright.config.ts) so specs give each visitor its own IP.
- `e2e/t062-receipts.spec.ts` (T062): pairs a client through the admin route (generate key, `client.create`), mints an
  inline intent with node:crypto, signs on `/sign/[token]` and asserts the 303 lands on the return URL with the receipt in
  the fragment only; then lookup and catalogue. `serve.mjs` gives the server a fixed test `EMDASH_ENCRYPTION_KEY` (unless
  one is set) so secret settings can be saved, and `EMDASH_SITE_URL=http://127.0.0.1:<port>`: e-sign queues no email
  with a relative link (T117).
- `e2e/t065-booking-with-waiver.spec.ts` (T065): `/e2e/waiver?slug=` renders the suite's `<BookingWithWaiver>`; a Free
  booking through it (no JS, an under-18 attendee), the C0 refusal, and `/_events/waiver` with an intent minted like Events
  Pro (flow cookie `semics_waiver_<ref>` set by the test): ceremony under `ceremonyCsp()`, receipt forwarded in-process
  (Free's `signatures/receipt` is a stub, so the notice is `waiver=failed`).
- `e2e/events.spec.ts`: journey, 3-zone email/ICS, and `load/checkout.mjs` (100 buyers, 16 in flight, last 5 volunteer seats).
- Specs: `e2e/events`, `e2e/smoke`, `e2e/harness`, `e2e/s2-public-route`, `e2e/s6-pt-block`, `e2e/t053-booking-page`,
  `e2e/t054-events-list` (card snapshots in `e2e/__snapshots__/`, one per theme, shared by every OS: regenerate
  with `--update-snapshots` if the CI font differs), `e2e/t055-booking-widget`.
