---
id: T002
title: "Changesets and versioning conventions"
phase: 0
package: repo
edition: free
status: in-progress
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

- [ ] `scripts/changeset-check.test.mjs`: a fixture diff touching `packages/events/src` with no changeset fails the check
- [ ] A diff touching only `tasks/` or docs passes without a changeset

## Implementation (green, then refactor)

- `.changeset/config.json`, `scripts/changeset-check.mjs` wired into `pnpm verify`
- Document the major-version rule for trust-contract changes in `CONTRIBUTING.md`

## Acceptance criteria

- [ ] `pnpm changeset status` works
- [ ] The check runs inside `pnpm verify`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
```
