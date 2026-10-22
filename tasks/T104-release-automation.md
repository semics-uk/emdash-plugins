---
id: T104
title: "Release automation"
phase: 7
package: repo
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T002, T071]
spec: [BUILD-PLAN §9]
---

# T104 · Release automation

## Definition

`emdash-plugin release setup` workflow wired to Changesets, npm provenance publish, and the Pro release workflow.

## Model

**Sonnet 5.5**: Generated workflows plus wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Dry-run release produces the expected artifacts
- [x] Workflows lint clean

## Implementation (green, then refactor)

- `.github/workflows/*.yml`

## Acceptance criteria

- [x] Documented in CONTRIBUTING
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
npx actionlint
```

## Notes

- Built: `.github/workflows/release.yml` (Changesets version PR, then `pnpm release` = strict dry run + `changeset publish` with
  npm provenance), `.github/workflows/emdash-release.yml` (the reusable registry workflow in the shape of
  `emdash-plugin release setup --trigger=changesets`, CLI 0.13.3; hand-written because `release setup` requires
  `emdash-plugin login <real DID>`), `scripts/release-dry-run.mjs` (+ tests), `scripts/release-workflows.test.mjs`,
  root scripts `version-packages`, `release`, `release:dry-run`, a `pnpm verify` gate, CONTRIBUTING "Releasing".
- Real CLI subcommands used: `release plan`, `release prepare`, `release setup`, and the `release-action` Action (OIDC +
  build attestation, no stored registry token). The registry job is off until the repo variable
  `EMDASH_REGISTRY_PUBLISH=true`, and the workflow refuses the placeholder DID (R21).
- `actionlint` is not installed here and `npx actionlint` is not available offline: workflows were checked with the
  offline shape test; CI's existing `actionlint` job lints them for real.
- The packages stay `"private": true` (not edited, to stay clear of T118); `pnpm release` refuses until the owner removes it.
- The Pro workflow is in the Pro repo, branch `pro-agent-t104`: `.github/workflows/pro-release.yml` + a shape test.
- Action pins: checkout, pnpm, setup-node and attest use the SHAs the CLI generator emits; `changesets/action@v1` and
  `emdash-cms/emdash/apps/release-action@main` are tag/branch refs for the owner to pin.
