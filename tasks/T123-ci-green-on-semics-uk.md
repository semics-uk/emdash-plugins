---
id: T123
title: "CI and Release green on the semics-uk repos"
phase: 6
package: suite
edition: free
status: in-progress
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

- [ ] Changesets pre mode is valid (`changeset pre enter rc` shape) with the rc changesets back in `.changeset/`; a script test guards the layout; the 1.0.0-rc.0 versions stay as they are
- [ ] land-pro script tests pass on a clean Linux runner (git identity, paths); test-first
- [ ] CI and Release green on main in `semics-uk/emdash-plugins` (push, then read the runs with `gh run`); Release must stop at the version PR / dry run and must not publish
- [ ] Pro repo CI state recorded; fix if red
- [ ] Meets the Definition of Done
