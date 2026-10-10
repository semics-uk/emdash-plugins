---
id: T003
title: "Shared library package and bundling into the sandbox"
phase: 0
package: shared
edition: free
status: backlog
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

- [ ] `packages/shared/tests/smoke.test.ts`: an exported pure function returns the expected value
- [ ] `packages/events/tests/shared-bundle.test.ts`: a route that calls the shared function returns its value through the sandbox host
- [ ] Build check: `dist/plugin.mjs` contains no `node:` imports

## Implementation (green, then refactor)

- `packages/shared` with `src/index.ts`, vitest config, tsconfig extending the base
- Workspace dependency from both cores; confirm the CLI bundles it (add an explicit test, not just a build)

## Acceptance criteria

- [ ] Both cores import from `@semics-tech/shared` and still pass `emdash-plugin validate` and `bundle`
- [ ] The registry tarball contains the inlined shared code
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter @semics-tech/emdash-esign verify
```
