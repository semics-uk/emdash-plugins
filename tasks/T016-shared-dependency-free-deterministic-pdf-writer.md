---
id: T016
title: "Shared: dependency-free deterministic PDF writer"
phase: 1
package: shared
edition: free
status: backlog
model: opus-5.5
size: L
depends_on: [T003, T007]
spec: [ES-FR-07, Spike S5 (local proxy), ES-NFR-01]
---

# T016 · Shared: dependency-free deterministic PDF writer

## Definition

Write PDFs with Helvetica text, wrapping, headings, tables (audit certificate) and vector paths for drawn signatures. Output is byte-for-byte deterministic for the same input.

## Model

**Opus 5.5**: Binary format writer with layout and performance constraints.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Two renders of the same input are byte-identical
- [ ] Output passes `qpdf --check` (CI) or a pure-JS parser in tests
- [ ] Text with accents and long words wraps within margins
- [ ] Stroke JSON renders as path operators, not images
- [ ] A 5-page waiver with 2 signatures renders under the local CPU ceiling (budget harness)

## Implementation (green, then refactor)

- `packages/shared/src/pdf/` (writer, fonts metrics, layout, strokes)

## Acceptance criteria

- [ ] No dependencies added
- [ ] Determinism test in CI
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
