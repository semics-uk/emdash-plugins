---
id: T006
title: "Spike S6: Portable Text blocks served by a sandboxed core"
phase: 0
package: events
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T004]
spec: [Spike S6, EU-FR-01]
---

# T006 · Spike S6: Portable Text blocks served by a sandboxed core

## Definition

Prove that the native UI entry can register an `events-list` Portable Text block whose data comes from the sandboxed core, rendered on a playground page.

## Model

**Sonnet 5.5**: Narrow spike with a visible pass/fail.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Playwright: an entry whose body contains an `events-list` block renders the block's component
- [x] Runtime host: the block's editor configuration validates as Block Kit

## Implementation (green, then refactor)

- Register `portableTextBlocks` in `src/ui/index.ts`; render through `blockComponents` in `src/astro/index.js`

## Acceptance criteria

- [x] Finding recorded in BUILD-PLAN §7; if negative, PRDs drop the blocks and keep components only
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```

## Notes

- Second test: `createPluginRuntimeTestHost()` only accepts site and i18n options and loads the built
  sandboxed plugin, so it cannot load the native UI descriptor. The block's `fields` are instead
  validated with `validateBlocks` from `@emdash-cms/blocks/server` (resolved through `emdash`), as a
  form block, with a negative case. Both tests live in `apps/playground/e2e/s6-pt-block.spec.ts`
  (the second needs no browser) because `packages/events/tests` belongs to another task.
- Block data is static in `EventList.astro` until T046 adds the public events route.
- Seed gained a `whats-on` page containing an `events-list` block.
- Finding recorded in BUILD-PLAN §7 (positive; the PRDs keep the blocks).
