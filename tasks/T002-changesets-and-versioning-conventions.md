---
id: T002
title: "Changesets and versioning conventions"
phase: 0
package: repo
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T001]
spec: [BUILD-PLAN §9, Management plan: Versioning]
---

# T002 · Changesets and versioning conventions

## Definition

Changesets configured for the three published packages with linked Free/Pro versioning rules documented. A check fails when a package's source changes without a changeset.

## Model

**Sonnet 5.5**: Standard tooling setup.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] `scripts/changeset-check.test.mjs`: a fixture diff touching `packages/events/src` with no changeset fails the check
- [x] A diff touching only `tasks/` or docs passes without a changeset

## Implementation (green, then refactor)

- `.changeset/config.json`, `scripts/changeset-check.mjs` wired into `pnpm verify`
- Document the major-version rule for trust-contract changes in `CONTRIBUTING.md`

## Acceptance criteria

- [x] `pnpm changeset status` works
- [x] The check runs inside `pnpm verify`
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
```

## Notes

- `ignore: ["playground"]` and `privatePackages: { version: true, tag: false }` so the still-private published packages are versioned but not tagged.
- No `fixed`/`linked` groups: Free/Pro lockstep is a release rule (Pro lives in the private repo), documented in CONTRIBUTING.md.
- The CLI is untested beyond the pure core (it only shells out to git); `packages/shared` is treated as unpublished by directory name.
- On `main` the verify step prints a skip message.
- `@changesets/cli` 3.0.3 (published 2026-09-14) added as the only dependency (+43 transitive packages).
