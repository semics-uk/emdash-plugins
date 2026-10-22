---
id: T031
title: "E-sign UI: signature pad"
phase: 1
package: esign
edition: free
status: review
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

- [x] Simulated pointer input produces the expected normalised points
- [x] Undo removes the last stroke
- [x] A typical signature stays within 32 KB
- [x] Touch, pen and mouse events handled (Playwright)

## Implementation (green, then refactor)

- `src/client/pad.ts`

## Acceptance criteria

- [x] No canvas raster is ever submitted
- [x] Pad output is `{ v, w, h, strokes }` with `[x, y]` points in pad coordinates (y down), the shape `renderPdf` signature blocks take (T016)
- [x] Pad writes `{ v, w, h, strokes }` JSON to the hidden `signatureStrokes` input in `[data-esign-pad-slot]` and fires a bubbling `input` event; its script is inlined and hashed (`assets.ts`, `ceremonyCsp`); typed name stays required (T030)
- [x] **Bug from T030:** `handleSign` calls the core under the default plugin id; make it use the integration's configured id (`virtual:semics-esign/config`) like the poll does, with a test using an `r_…` id
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```

## Notes

- The file is `src/client/pad.js` (plain JS + `pad.d.ts`), not `pad.ts`: the page inlines its exact text and allows it by SHA-256 (`PAD_SCRIPT` in `assets.ts`, second hash in `ceremonyCsp()`), like `ceremony.js`. The existing T030 e2e CSP test now expects two scripts.
- Pad space is 600 x 200, whole-pixel points, caps of 64 strokes and 1500 points (about 21 KB normalised). Drawing is optional; the typed name stays required, and with no JS there is no pad.
- Bug fix: `PublicRouteContext` gained `pluginId`; `SignPage.astro` passes the integration id, so session, submit, decline and the re-read all use it (test uses `r_abc123`). `<SigningCeremony>` already gave the poll the id.
- Keyboard users cannot draw (no accessible way to trace a path); Undo and Clear are real buttons and the canvas label says typing the name is enough.
- Playground e2e: 36 passed, 1 skipped (the T029-era skip); ran once, no servers left.
