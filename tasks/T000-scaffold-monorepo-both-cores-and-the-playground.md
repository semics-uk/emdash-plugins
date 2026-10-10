---
id: T000
title: "Scaffold monorepo, both cores and the playground"
phase: 0
package: repo
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: []
spec: [BUILD-PLAN §2, Spikes S10a, S11]
---

# T000 · Scaffold monorepo, both cores and the playground

## Definition

pnpm workspace, both sandboxed cores scaffolded with `emdash-plugin init`, a native UI entry in the events package, and a Node playground with the workerd sandbox runner. Spikes S10a and S11 proven.

## Model

**Sonnet 5.5**: Mechanical scaffolding with the official CLI.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Scaffold tests in `packages/*/tests/plugin.test.ts` pass through Worker Loader
- [ ] Probe route proved Ed25519 sign/verify and `ctx.site.url` inside the sandbox

## Implementation (green, then refactor)

- Done in commit 25e7b78

## Acceptance criteria

- [ ] Both cores validate, typecheck, test and build
- [ ] Playground logs `Loaded sandboxed plugin semics-events:0.1.0`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm -r --filter ./packages/** test
```
