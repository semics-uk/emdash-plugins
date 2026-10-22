---
id: T118
title: "Bundle size headroom for Pro builds"
phase: 4
package: repo
edition: free
status: in-progress
model: opus-5.5
size: M
depends_on: [T063]
spec: [R42]
---

# T118 · Bundle size headroom for Pro builds

## Definition

The Pro Events backend is 127.0 KiB against a 128 KiB per-file bundle limit (T063), so the next Pro
features (T064, T073+) will not fit. Find out exactly where the limit comes from and whether it applies to
Pro builds installed from private npm under `sandboxed: [...]` (runtime/Worker Loader limit) or only to
registry bundles (`emdash-plugin validate`/`bundle`). Then create lasting headroom (R42), in this order of
preference: (1) shrink the Free core without behaviour change (measure what dominates: `zod/mini`,
duplicated shared helpers, Block Kit builders, string tables; tree-shaking and minification settings);
(2) if the limit is per file, split the bundle into several modules if the loader supports it; (3) only if
the limit is registry-only, record that Pro may exceed it and add a Pro-specific ceiling that still fails
the build well before any runtime limit.

## Model

**Opus 5.5**: Build-tool and platform investigation with a measurable outcome.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] A build-size test per bundle (Free events, Free esign, Pro events, Pro esign) asserts a budget that leaves ≥ 24 KiB headroom under the applicable limit
- [ ] The behaviour suites stay green (no functional change)

## Implementation (green, then refactor)

- Build config in `packages/events`, `packages/esign`, `packages/shared`; Pro repo build scripts if needed

## Acceptance criteria

- [ ] Source of the 128 KiB limit cited (file and line in the EmDash sources) and recorded in BUILD-PLAN §7
- [ ] Size table before/after per bundle in the task Notes
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
corepack pnpm@10.23.0 verify
```
