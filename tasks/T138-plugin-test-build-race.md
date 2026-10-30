---
id: T138
title: "CI: plugin-test workers share one plugin build"
phase: 6
package: esign
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T125]
spec: [R99]
---

# T138 · CI: plugin-test workers share one plugin build

## Definition

CI run 40977871213 (commit 5c440bd, no E-sign change) failed 14 tests in
`packages/esign/tests/from-intent.routes.test.ts` with `SyntaxError: Unexpected end of JSON input` from
`createPluginRuntimeTestHost`; the run before it passed. The Cloudflare workers pool calls the
`@emdash-cms/plugin-test` options callback once per pool worker, and each call runs `buildPlugin`, which rewrites
`dist/manifest.json` in place with a plain `writeFile`. With two workers starting together, one can read the file
while the other has truncated it. Fix it so concurrent workers never read a build in progress.

A separate report of 14 CPU-budget overruns (125 ms against 50 ms) came from a local `pnpm verify` run under
coverage on a machine running other suites; it did not reproduce: 612/612 E-sign tests pass locally without
coverage (2026-10-30). Budgets stay as T125 left them.

## Acceptance criteria

- [x] Test first: `packages/esign/tests/plugin-test-build.build.test.ts`, six concurrent pool starts share one build
- [x] Fix: a pnpm patch of `@emdash-cms/plugin-test@0.2.8` shares the in-flight build per plugin folder (R99)
- [x] E-sign suite green locally (613/613, 2026-10-30); CI green on main in semics-uk/emdash-plugins: run 41021537889 (1e1d69c)
- [x] Meets the Definition of Done

## Notes

- A later, non-overlapping start still rebuilds, so `vitest` watch mode still picks up source changes.
- Upstream: the same fix belongs in `@emdash-cms/plugin-test` (or an atomic write in `buildPlugin`); drop the
  patch when a release has it.
