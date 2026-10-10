---
id: T006
title: "Spike S6: Portable Text blocks served by a sandboxed core"
phase: 0
package: events
edition: free
status: backlog
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

- [ ] Playwright: an entry whose body contains an `events-list` block renders the block's component
- [ ] Runtime host: the block's editor configuration validates as Block Kit

## Implementation (green, then refactor)

- Register `portableTextBlocks` in `src/ui/index.ts`; render through `blockComponents` in `src/astro/index.js`

## Acceptance criteria

- [ ] Finding recorded in BUILD-PLAN §7; if negative, PRDs drop the blocks and keep components only
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```
