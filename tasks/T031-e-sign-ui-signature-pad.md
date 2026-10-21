---
id: T031
title: "E-sign UI: signature pad"
phase: 1
package: esign
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T029]
spec: [SU-FR-05, SU-NFR-04]
---

# T031 · E-sign UI: signature pad

## Definition

Pointer-events pad producing normalised stroke JSON (`{ v, w, h, strokes }`) with Clear and Undo.

## Model

**Sonnet 5.5**: Self-contained client module.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Simulated pointer input produces the expected normalised points
- [ ] Undo removes the last stroke
- [ ] A typical signature stays within 32 KB
- [ ] Touch, pen and mouse events handled (Playwright)

## Implementation (green, then refactor)

- `src/client/pad.ts`

## Acceptance criteria

- [ ] No canvas raster is ever submitted
- [ ] Pad output is `{ v, w, h, strokes }` with `[x, y]` points in pad coordinates (y down), the shape `renderPdf` signature blocks take (T016)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
