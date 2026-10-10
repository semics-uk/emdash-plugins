---
id: T001
title: "Repo quality gates: lint, format, verify script, CI workflow"
phase: 0
package: repo
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T000]
spec: [Management plan: Release gates]
---

# T001 · Repo quality gates: lint, format, verify script, CI workflow

## Definition

One command, `pnpm verify`, runs every gate locally: Biome lint and format check, typecheck, unit and plugin-host tests with coverage, manifest validation and builds. A GitHub Actions workflow runs the same command (written now, active once the repo is pushed).

## Model

**Sonnet 5.5**: Configuration work with well-known tools.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] `scripts/verify.test.mjs`: running `pnpm verify` on a deliberately broken fixture exits non-zero
- [ ] Biome config rejects an unused import in a fixture file
- [ ] Coverage thresholds fail the run when a fixture module is below 90% lines

## Implementation (green, then refactor)

- Add Biome (`biome.json`), root `verify` script, per-package `verify` scripts (validate, typecheck, test --coverage, build)
- Vitest coverage via v8 with per-package thresholds: 90% lines for `src/domain/**` and `packages/shared/**`
- `.github/workflows/ci.yml` running `pnpm verify` and Playwright on Node
- `.editorconfig`, `CONTRIBUTING.md` with the TDD standard from `tasks/README.md`

## Acceptance criteria

- [ ] `pnpm verify` passes on a clean checkout
- [ ] Each package exposes a `verify` script
- [ ] CI workflow lints with `actionlint`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
npx actionlint .github/workflows/ci.yml
```
