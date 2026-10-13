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
- Specs: `e2e/smoke`, `e2e/harness`, `e2e/s2-public-route` (success test skipped until T054 points it at
  `public/events`), `e2e/s6-pt-block`.
