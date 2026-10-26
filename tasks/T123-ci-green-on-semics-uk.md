---
id: T123
title: "CI and Release green on the semics-uk repos"
phase: 6
package: suite
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T106, T121, T122]
spec: [R64, R84]
---

# T123 · CI and Release green on the semics-uk repos

## Definition

CI has never passed on `semics-uk/emdash-plugins` (runs since the first push all fail). Release fails with
`ENOENT .changeset/pre/changes.md`: `.changeset/pre/` is a directory holding the rc changesets and
`.changeset/pre.json` lacks `initialVersions`/`changesets`, so changesets reads `pre/` as a v1 changeset.
CI's `pnpm verify` fails in Script tests on the land-pro tests (`scripts/orchestrator`). Check the Pro repo's
workflows have run on main too.

## Acceptance criteria

- [x] Changesets pre mode is valid (`changeset pre enter rc` shape) with the rc changesets back in `.changeset/`; a script test guards the layout; the 1.0.0-rc.0 versions stay as they are
- [x] land-pro script tests pass on a clean Linux runner (git identity, paths); test-first
- [x] CI and Release green on main in `semics-uk/emdash-plugins` (push, then read the runs with `gh run`); Release must stop at the version PR / dry run and must not publish
- [x] Pro repo CI state recorded; fix if red
- [x] Meets the Definition of Done

## Outcome

CI green on main: run 40299441395 (6e6fa83, after T125). Release green and publishing gated on `NPM_PUBLISH`.
Criterion 1 deviation: Changesets CLI 3 keeps consumed rc changesets in `.changeset/pre/` and rewrites
`pre.json` to `{mode, tag}`, so that layout stays; the fault was `changesets/action@v1`, now v2.1.2. The Pro
repo runs no CI on push (only `pro-release.yml`, by tag or by hand); its tests run in the landing checks.
