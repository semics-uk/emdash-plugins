---
id: T139
title: "Release: the registry workflow plans when release.yml calls it"
phase: 6
package: suite
edition: free
status: in-progress
model: opus-5.5
size: S
depends_on: [T138]
spec: [R86]
---

# T139 · Release: the registry workflow plans when release.yml calls it

## Definition

Release run 41031909704 published 1.0.0-rc.1 of the three Free packages to npm but failed the EmDash registry
publish: in `emdash-release.yml` the Changesets plan step ran only `if: github.event_name == 'workflow_call'`, but a
called workflow sees the caller's event (`push`), so neither plan step ran, `selectors` was empty and
`fromJSON('')` failed the publish job. Plan on any event but `workflow_dispatch`, and skip publish on an empty plan.

## Acceptance criteria

- [x] Test first (`scripts/release-workflows.test.mjs`), then the fix
- [ ] CI green on main; rc.1 published to the EmDash registry (run id recorded)
- [ ] Meets the Definition of Done
