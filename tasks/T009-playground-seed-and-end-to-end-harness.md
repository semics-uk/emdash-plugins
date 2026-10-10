---
id: T009
title: "Playground seed and end-to-end harness"
phase: 0
package: playground
edition: free
status: backlog
model: sonnet-5.5
size: M
depends_on: [T000, T001]
spec: [BUILD-PLAN §8, Events PRD: content model]
---

# T009 · Playground seed and end-to-end harness

## Definition

Seed an `events` collection (title, slug, body, startsAt, endsAt, timezone, venue, image, summary) and sample entries; add Playwright with a script that builds, seeds a fresh database and starts the site.

## Model

**Sonnet 5.5**: Configuration and fixtures.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Playwright smoke: home page 200, an event entry page renders its title
- [ ] Harness test: two runs start from identical seeded state

## Implementation (green, then refactor)

- `apps/playground/seed/seed.json` events collection
- `apps/playground/e2e/` with `playwright.config.ts` using the preinstalled Chromium
- `pnpm --filter playground e2e` script

## Acceptance criteria

- [ ] E2E runs headless locally in under 2 minutes
- [ ] Database and uploads reset per run
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```
