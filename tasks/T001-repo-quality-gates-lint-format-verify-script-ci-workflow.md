---
id: T001
title: "Repo quality gates: lint, format, verify script, CI workflow"
phase: 0
package: repo
edition: free
status: review
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

- [x] `scripts/verify.test.mjs`: running `pnpm verify` on a deliberately broken fixture exits non-zero
- [x] Biome config rejects an unused import in a fixture file
- [x] Coverage thresholds fail the run when a fixture module is below 90% lines

## Implementation (green, then refactor)

- Add Biome (`biome.json`), root `verify` script, per-package `verify` scripts (validate, typecheck, test --coverage, build)
- Vitest coverage via v8 with per-package thresholds: 90% lines for `src/domain/**` and `packages/shared/**`
- `.github/workflows/ci.yml` running `pnpm verify` and Playwright on Node
- `.editorconfig`, `CONTRIBUTING.md` with the TDD standard from `tasks/README.md`

## Acceptance criteria

- [x] `pnpm verify` passes on a clean checkout
- [x] Each package exposes a `verify` script
- [x] CI workflow lints with `actionlint`
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
npx actionlint .github/workflows/ci.yml
```

## Notes

- `pnpm verify` is `node scripts/verify.mjs`: Biome `ci`, `tasks:check`, `test:scripts`, each package's `verify` (validate, typecheck, `vitest run --coverage`, build), then the playground typecheck. It stops at the first failure and accepts `--root <dir>` so the test can point it at a broken fixture.
- Coverage: `vitest.coverage.mjs` (with `.d.mts` types) gives per-glob 90% line thresholds on `src/domain/**`; `coverageConfig({ allSource: true })` is for `packages/shared`. Empty globs do not fail (tested). Coverage fixtures are generated at test time under `scripts/.gate-fixture-*` (gitignored, removed afterwards).
- `actionlint` is not installed offline, so it was not run. The workflow has an `actionlint` job (docker action) that lints it in CI; locally the YAML was only parsed with the `yaml` package (0 errors). Run `npx actionlint .github/workflows/ci.yml` once online.
- The Playwright job is skipped unless a `playwright.config.*` exists (no Playwright dependency yet).
- Biome scope excludes `apps/playground` (another task is editing it; its `emdash-env.d.ts` is generated) and `*.astro`/`*.md`. Existing code was reformatted by Biome (formatting only, including `tsconfig*.json`, `packages/*/tests`, `scripts/*`). Bring the playground into scope in a follow-up.
- Definition of Done items not applicable here: no changeset (no published package changed), no route budgets; automated code review left to the orchestrator.
