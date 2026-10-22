---
id: T071
title: "Pro build pipeline and Free→Pro data continuity"
phase: 4
package: repo
edition: pro
status: review
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

- [x] Pro build passes validate and bundle with the same slug
- [x] Playground: data created on Free is visible after switching to Pro and back
- [x] Pro-only routes absent from the Free bundle

## Implementation (green, then refactor)

- A separate local git repo `../emdash-plugins-pro` (sibling of this one; R40), never committed here: `packages/events-pro/`, `packages/esign-pro/`, its own pnpm workspace linking the public packages with `link:`, its own `pnpm verify`, `scripts/orchestrator/land.sh` support for both repos

## Acceptance criteria

- [x] S10b recorded
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```

## Notes

- **Pro code is not in this repo (R40).** It lives in the separate local git repo
  `/Users/semics/code/semics/emdash-plugins-pro` (no remote yet; its README has the layout and how a
  Pro task adds a feature). Its own `pnpm verify` (quiet, `.verify.log`) runs Biome, script tests,
  manifest/constant generation, then each package's validate, typecheck, tests and build. This repo
  only gains the S10b result and R41 in BUILD-PLAN and `scripts/orchestrator/land-pro.sh` (+ its test),
  which `land.sh` now calls after landing the public side.
- **Playground vs runtime host.** The "Playground" test is done on the EmDash runtime test host
  instead: installing Pro into `apps/playground` would put Pro into this repo. The Pro repo's
  `*.editions.test.ts` load the real Free build, then the Pro build, then Free again, each as a fresh
  EmDash runtime and isolate over one local D1 database (BUILD-PLAN S10b has the details and the
  `<slug>:<version>` cache caveat). `pnpm --filter playground e2e` was not run: nothing in a package or
  the playground changed, and no playground port was assigned.
- **No extension point was needed in the public cores**: the Pro `src/plugin.ts` imports the Free
  core's default export from the linked source and composes it (`extendCore`). So `packages/events`
  and `packages/esign` are untouched, and no changeset is needed (only `scripts/` changed).
- The Pro repo's `link:` paths are relative, so Pro worktrees go in
  `/Users/semics/code/semics/.pro-worktrees/agent-<id>` (branch `pro-agent-<id>`), where a symlink
  `emdash-plugins -> ../emdash-plugins` (created by this task) makes them resolve. Pro builds link
  the public **main checkout**, so a Pro task that needs a public change lands that first.
- TDD order: `generate.mjs` and `verify.mjs` in the Pro repo were written with the scaffold, before
  their node tests, because the test configs need the generator to build at all. Red runs: with no
  Pro `src/plugin.ts` both packages fail to build (`MISSING_PLUGIN_ENTRY`); with a Pro build that only
  re-exported Free, the continuity test failed exactly at the missing `pro/licence` route; pro-kit
  tests failed on the missing module. Green: Pro verify passes (pro-kit 13, events-pro 13,
  esign-pro 8 tests, script tests 10); land-pro test 4/4.
- Follow-ups: T072 issues the real key pair and commits only `licence/public-key.txt` to the Pro
  repo; Pro packaging should run `node scripts/generate.mjs --release` (refuses a dev key) before
  publishing; T073 adds `api.stripe.com` through `pro.json` and may need the Free
  checkout `PaymentStep` seam exported so Pro can supply it (add it here, MIT, test-first). The edition tests print expected
  "Route not found: pro/licence" and workerd "hung" lines from the downgrade check; they are noise.
