---
id: T003
title: "Shared library package and bundling into the sandbox"
phase: 0
package: shared
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T001]
spec: [BUILD-PLAN §4]
---

# T003 · Shared library package and bundling into the sandbox

## Definition

Create `packages/shared` (`@semics-tech/shared`, private, not published). Prove that `emdash-plugin build` bundles a workspace TypeScript module into each core's `backend.js` with no Node built-ins.

## Model

**Sonnet 5.5**: Small, mechanical, with a clear pass/fail.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] `packages/shared/tests/smoke.test.ts`: an exported pure function returns the expected value
- [x] `packages/events/tests/shared-bundle.test.ts`: a route that calls the shared function returns its value through the sandbox host
- [x] Build check: `dist/plugin.mjs` contains no `node:` imports

## Implementation (green, then refactor)

- `packages/shared` with `src/index.ts`, vitest config, tsconfig extending the base
- Workspace dependency from both cores; confirm the CLI bundles it (add an explicit test, not just a build)

## Acceptance criteria

- [x] Both cores import from `@semics-tech/shared` and still pass `emdash-plugin validate` and `bundle`
- [x] The registry tarball contains the inlined shared code
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- **Declare shared as a `devDependency`, not a `dependency`.** The emdash-plugin CLI (tsdown) externalizes
  everything in the cwd package's `dependencies`/`peerDependencies`; with `"@semics-tech/shared"` there the
  build failed (`Cannot find package '@semics-tech/shared'` in the probe) and would ship an unresolved
  import. In `devDependencies` the bundler inlines it. Consequence: the changeset check (which only
  watches `dependencies`/`peerDependencies`) needs no changeset, and no runtime dependency changes, so
  none was added. Later tasks must keep workspace libraries in `devDependencies`.
- **No test-only route in a core.** The cores' `src/` is unchanged (they do not yet import shared: the
  other agent owns `packages/events/src`, and no real code needs a helper yet). The proof uses a
  fixture plugin in `tests/fixtures/shared-plugin` (own manifest and `package.json`, never published)
  that imports `sharedVersion()` and exposes a `version` route. Each core's `vitest.config.ts` now has
  three projects: `core` (the real plugin, workerd), `shared-host` (fixture plugin through
  `createPluginTestHost`, tests/shared-bundle.test.ts) and `shared-build` (plain Node,
  tests/shared-bundle.build.test.ts).
- The build test runs `buildPlugin` and `bundlePlugin` on the fixture into a temp dir, asserts
  `plugin.mjs` has no `node:` imports and no leftover `@semics-tech/shared` import, and reads
  `backend.js` out of the tarball to confirm the shared code is inlined. The tarball lives in the temp
  dir and is deleted by the test.
- Acceptance "both cores import from shared" is satisfied at dependency level only; the first real
  import arrives with the first task that needs a shared helper (add the import then; the bundling is
  already proven).
- `packages/shared` resolves by source (`exports: {".": "./src/index.ts"}`), working in vitest, tsc and
  the emdash-plugin build.
