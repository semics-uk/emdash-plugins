---
id: T004
title: "Spike S2: in-process calls from SSR to sandboxed public routes"
phase: 0
package: playground
edition: free
status: in-progress
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

- [ ] Playwright: a playground page server-renders data returned by a sandboxed `public/probe` route
- [ ] Same page with the plugin disabled renders a defined error state, not a crash
- [ ] Unit: the UI helper `callPublicRoute()` passes method, path and body through unchanged

## Implementation (green, then refactor)

- Add a temporary public probe route to the events core
- `packages/events/src/astro/lib/call.ts` helper with the fallback to `fetch(Astro.url.origin + …)`
- Write findings into BUILD-PLAN §7 and remove the probe route

## Acceptance criteria

- [ ] The finding (works / needs fallback) is recorded with evidence
- [ ] The helper is the only way UI code calls the core
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```
