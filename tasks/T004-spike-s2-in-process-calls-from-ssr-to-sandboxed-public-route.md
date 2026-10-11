---
id: T004
title: "Spike S2: in-process calls from SSR to sandboxed public routes"
phase: 0
package: playground
edition: free
status: review
model: opus-5.5
size: S
depends_on: [T000]
spec: [Spike S2, RESEARCH §4, EU-FR-02]
---

# T004 · Spike S2: in-process calls from SSR to sandboxed public routes

## Definition

Prove whether `getPublicPluginApiRouteHandler(Astro.locals)` reaches a sandboxed plugin's public route on the Node runner, and record the result and the fallback decision in BUILD-PLAN §7.

## Model

**Opus 5.5**: Platform investigation whose answer shapes every UI component; needs careful reading of EmDash internals.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Playwright: a playground page server-renders data returned by a sandboxed `public/probe` route
- [x] Same page with the plugin disabled renders a defined error state, not a crash
- [x] Unit: the UI helper `callPublicRoute()` passes method, path and body through unchanged

## Implementation (green, then refactor)

- Add a temporary public probe route to the events core
- `packages/events/src/astro/lib/call.ts` helper with the fallback to `fetch(Astro.url.origin + …)`
- Write findings into BUILD-PLAN §7 and remove the probe route

## Acceptance criteria

- [x] The finding (works / needs fallback) is recorded with evidence
- [x] The helper is the only way UI code calls the core
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```

## Notes

- **Finding: in-process works.** `getPublicPluginApiRouteHandler(Astro.locals)` reaches sandboxed
  public routes on the Node workerd runner. The evidence is in BUILD-PLAN §7 under "Resolved
  locally". `callPublicRoute()` keeps the `fetch(Astro.url.origin + …)` fallback only for when
  `locals.emdash` has no handler.
- The probe route was removed as the task says. So the Playwright success test (its evidence is in
  commit `feat(T004)`, where it passed) is now `test.skip` with a reason. T009 should repoint it at
  the first real public route. The error-state test still runs. The `/spike/s2` page accepts
  `?plugin=` so the test can target a non-enabled plugin ID. That gives the same `NOT_FOUND` path
  as a real disable (`_plugin_state.status = 'inactive'` plus a restart), which I checked by hand.
- `callPublicRoute` and `EVENTS_PLUGIN_ID` are exported from `@semics-tech/emdash-events/astro`.
- Playwright: `@playwright/test` 1.56.1 is a playground devDependency. `playwright.config.ts` runs
  the system Chrome (`channel: "chrome"`) on port 4401. `pnpm --filter playground e2e` builds the
  site first, but the events package must already be built (`dist/`).
- The workerd sandbox runner binds fixed ports from 18788. An orphaned `workerd` from an earlier
  playground run blocked startup (`bind(): Address already in use`) and had to be killed. Two
  playground servers can't run at the same time, which matters for parallel agents and T009.
- Unchecked DoD items are for the reviewer: automated code review, and status `done`.
  `pnpm verify` and both Verify commands pass. A changeset is added (minor, events).
