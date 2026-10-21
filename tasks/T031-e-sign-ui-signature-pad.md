---
id: T031
title: "E-sign UI: signature pad"
phase: 1
package: esign
edition: free
status: in-progress
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
- [ ] Pad writes `{ v, w, h, strokes }` JSON to the hidden `signatureStrokes` input in `[data-esign-pad-slot]` and fires a bubbling `input` event; its script is inlined and hashed (`assets.ts`, `ceremonyCsp`); typed name stays required (T030)
- [ ] **Bug from T030:** `handleSign` calls the core under the default plugin id; make it use the integration's configured id (`virtual:semics-esign/config`) like the poll does, with a test using an `r_…` id
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
