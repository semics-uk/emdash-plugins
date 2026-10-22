---
id: T071
title: "Pro build pipeline and Free→Pro data continuity"
phase: 4
package: repo
edition: pro
status: in-progress
model: opus-5.5
size: M
depends_on: [T070, T057, T034]
spec: [BUILD-PLAN §13, Spike S10b]
---

# T071 · Pro build pipeline and Free→Pro data continuity

## Definition

Private `events-pro` and `esign-pro` packages build a superset of the cores with the same slug; prove storage survives swapping Free for Pro and back.

## Model

**Opus 5.5**: Build architecture with a data-safety proof.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Pro build passes validate and bundle with the same slug
- [ ] Playground: data created on Free is visible after switching to Pro and back
- [ ] Pro-only routes absent from the Free bundle

## Implementation (green, then refactor)

- A separate local git repo `../emdash-plugins-pro` (sibling of this one; R40), never committed here: `packages/events-pro/`, `packages/esign-pro/`, its own pnpm workspace linking the public packages with `link:`, its own `pnpm verify`, `scripts/orchestrator/land.sh` support for both repos

## Acceptance criteria

- [ ] S10b recorded
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```
