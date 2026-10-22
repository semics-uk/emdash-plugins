---
id: T116
title: "Cron scheduling without plugin:activate"
phase: 2
package: repo
edition: free
status: in-progress
model: opus-5.5
size: M
depends_on: [T056]
spec: [R23, R37]
---

# T116 · Cron scheduling without plugin:activate

## Definition

EmDash 1.2 does not run `plugin:activate` for sandboxed plugins declared under `sandboxed: [...]` in
`astro.config.mjs` (found in T056), so a config/npm install of either core never schedules its recurring
tasks: Events never sweeps holds (`sweep-holds`) or sends mail (`outbox-drain`), E-sign never drains its
outbox. Make both cores self-schedule regardless of how they were installed (R37), without breaking the
bridge budget, and report the upstream behaviour.

Investigate first (read `node_modules/emdash` and `@emdash-cms/cloudflare` sources): is there another
lifecycle hook that runs for config-declared sandboxed plugins (install, first request, `plugin:install`,
`cron` registration in the manifest)? Prefer a declarative mechanism if one exists. Otherwise ensure
schedules lazily: a cheap check (one KV `get` of a `cron:scheduled:v1` flag) on paths that always run on a
live site (public routes that the UI calls, admin page loads, content hooks), scheduling the recurring
tasks once and setting the flag; budget it into every affected route (≤ 10, target ≤ 8).

## Model

**Opus 5.5**: Platform behaviour, both packages, budget trade-offs.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] A host that never calls `plugin:activate` still ends up with `sweep-holds` and `outbox-drain` (Events) and the E-sign outbox drain scheduled after the first public route or admin load
- [ ] Scheduling happens once (flag set; later calls make only the one check, or none)
- [ ] Every affected route stays within budget (`expectWithinBudget`)
- [ ] The playground's `/e2e/cron` no longer needs to activate the core itself

## Implementation (green, then refactor)

- `packages/events/src/plugin.ts`, `packages/esign/src/plugin.ts`, a small shared helper if useful

## Acceptance criteria

- [ ] Upstream report drafted in `docs/upstream/emdash-sandboxed-activate.md` (repro, expected, actual) for the owner to file
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
corepack pnpm@10.23.0 verify
```
