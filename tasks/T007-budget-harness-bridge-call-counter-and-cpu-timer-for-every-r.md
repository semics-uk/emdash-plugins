---
id: T007
title: "Budget harness: bridge-call counter and CPU timer for every route test"
phase: 0
package: shared
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T003]
spec: [EV-NFR-01, EV-NFR-02, ES-NFR-01, Spike S1 (local proxy)]
---

# T007 · Budget harness: bridge-call counter and CPU timer for every route test

## Definition

A test utility that wraps the plugin test hosts, counts bridge calls (storage, kv, content, http, email) and CPU time per invocation, and lets each test assert `≤ 10 calls` and a CPU ceiling. Until Cloudflare staging exists (T110), this is the enforcement for the platform limits.

## Model

**Opus 5.5**: Has to hook into the test hosts' bridge without breaking isolation; subtle instrumentation.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Counter reports exactly N calls for a fixture route that makes N storage gets
- [x] `expectWithinBudget(result, { calls: 10 })` fails with a readable diff when a route makes 11 calls
- [x] CPU timer reports a stable figure (±20%) across 5 runs of a fixed workload

## Implementation (green, then refactor)

- `packages/shared/testing/budget.ts` (test-only export), documented in `tasks/README.md`
- Adopted by the scaffold tests in both cores

## Acceptance criteria

- [ ] Every later route task asserts its budget with this helper
- [x] Readable failure output names the calls made
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **How it hooks in.** `withBudget()` wraps the `env.LOADER` Worker Loader binding (once per test
  isolate). Each plugin worker is loaded under a separate name with one extra main module that
  subclasses the runner's generated entrypoint and gives the plugin a recording proxy of `BRIDGE`,
  created per invocation (so concurrent invocations never share a list). The host stub unwraps the
  report and returns or rethrows exactly what the plugin did. Reports attach to the enclosing
  `measure()` through `AsyncLocalStorage`. Plugin code, the bridge and capability checks are untouched.
- **Covered:** `createPluginTestHost()` and `createPluginRuntimeTestHost()` (`transport`, and anything
  else run inside `budget.measure()`). Calls are named `kind.method` from the bridge method
  (`storageGet` -> `storage.get items k0`, `log("info")` -> `log.info`, `httpFetch` -> `http.fetch`).
- **CPU figure** = sandbox wall time minus time waiting on bridge calls. workerd has no CPU clock
  (`process.cpuUsage` is not implemented), so this is a proxy. On a quiet machine 5 runs sit within a
  few percent; with load average ~12 on this 4P+4E Mac, single runs land on efficiency cores at 2-6x.
  The stability test therefore warms up with the full workload and has `retry: 3` (each retry is a
  fresh 5-run batch). Routes asserting the 50 ms default have plenty of headroom; T110 measures for real.
- Extra tests beyond the three listed: batch read = 1 call, every bridge kind (settings/kv/storage/log),
  concurrent attribution, hooks, failed invocations, runtime host, default platform budget, CPU excludes
  bridge waits and the CPU ceiling fails, and `tests/testing-boundary.test.ts` (no package `src/` imports
  the harness).
- **Deviation:** "Adopted by the scaffold tests in both cores" is not done here: `packages/events`
  (T040) and `packages/esign` (T020) were being edited by other agents, and I was told not to touch
  them. Follow-up: add `@semics-tech/shared` devDependency use of `@semics-tech/shared/testing` and one
  `expectWithinBudget` per route/cron in `packages/{events,esign}/tests/plugin.test.ts`.
- `packages/shared` now has devDependencies on `@emdash-cms/plugin-test`, `@emdash-cms/plugin-cli` and
  `emdash` (for the fixture plugin under `tests/fixtures/budget-plugin`, run by the `budget-host`
  vitest project).
- This worktree branched before `packages/shared/CONTEXT.md` landed on main; that file already says
  `testing/` holds the budget harness.
