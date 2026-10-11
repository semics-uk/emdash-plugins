---
id: T009
title: "Playground seed and end-to-end harness"
phase: 0
package: playground
edition: free
status: done
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

- [x] Playwright smoke: home page 200, an event entry page renders its title
- [x] Harness test: two runs start from identical seeded state

## Implementation (green, then refactor)

- `apps/playground/seed/seed.json` events collection
- `apps/playground/e2e/` with `playwright.config.ts` using the preinstalled Chromium
- `pnpm --filter playground e2e` script

## Acceptance criteria

- [x] E2E runs headless locally in under 2 minutes (37 s including build on an unloaded machine, verified by the orchestrator 2026-10-11; 4 min 40 s under heavy parallel load) (see Notes)
- [x] Database and uploads reset per run
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```

## Notes

- `pnpm --filter playground e2e`: `e2e/harness/build.mjs` builds the events package then the site; Playwright's
  webServer runs `e2e/harness/serve.mjs`, which deletes `data.db*` and `uploads/`, applies `seed/seed.json` with
  `emdash seed` (migrates and seeds, deterministic, no first-request auto-seed race) and serves on 4401. Playwright
  SIGTERMs it and the script kills the whole process group, so workerd goes too.
- Deviation: seed field slugs must be snake_case (`startsAt` fails seed validation), so the fields are `starts_at`
  and `ends_at`, not BUILD-PLAN §3.1's `startsAt`/`endsAt`. BUILD-PLAN §3.1 and later tasks reading these fields
  should use `starts_at`/`ends_at` (or the settings field mapping). `slug` is EmDash's built-in entry slug, not a
  declared field. Sample events carry no image (no media in the seed).
- Timing: tests alone take about 13s warm; the first cold run is about 1.8m (first requests start workerd, 17-25s
  each). The site build took 2.5 min on a loaded machine (load average about 9 from other agents), so the full
  command exceeded 2 minutes here. `E2E_SKIP_BUILD=1` skips builds when only specs changed.
- Harness proof: `harness.spec.ts` fingerprints the seeded events, compares with the previous run's
  (`.e2e-state/`, gitignored) and plants a stale upload that the next run must find deleted. Seen passing on
  consecutive runs.
- The S2 spec and `/spike/s2` are unchanged (the success test stays skipped until T046).
- `pnpm verify` failed once with test timeouts in packages/events and packages/esign under load, and passed on rerun.
