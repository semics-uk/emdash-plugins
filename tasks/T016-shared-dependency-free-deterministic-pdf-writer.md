---
id: T016
title: "Shared: dependency-free deterministic PDF writer"
phase: 1
package: shared
edition: free
status: review
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

- [x] Two renders of the same input are byte-identical
- [x] Output passes `qpdf --check` (CI) or a pure-JS parser in tests
- [x] Text with accents and long words wraps within margins
- [x] Stroke JSON renders as path operators, not images
- [x] A 5-page waiver with 2 signatures renders under the local CPU ceiling (budget harness)

## Implementation (green, then refactor)

- `packages/shared/src/pdf/` (writer, fonts metrics, layout, strokes)

## Acceptance criteria

- [x] No dependencies added
- [x] Determinism test in CI
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```

## Notes

- **API** (`packages/shared/src/pdf/`, exported from the package root): `renderPdf(doc) → Uint8Array<ArrayBuffer>`
  (sync, so the bytes can go straight to `crypto.subtle.digest`), `measureText`, `wrapText`, `toWinAnsi`,
  `MAX_SIGNATURE_POINTS`. A document is `{ info?, page?, footer?, blocks }`. The blocks are `heading` (1–3),
  `paragraph` (size, font regular/bold/italic, align), `table` (weighted columns, wrapped cells, header repeated
  on each page, a row taller than a page split by line), `signature` (label, stroke JSON, typed name in
  Helvetica-Oblique, caption lines; kept on one page), `rule`, `spacer` and `pageBreak`. The footer takes text
  and/or "Page n of N". Defaults: A4, 56 pt margins.
- **Determinism:** no clock, randomness, compression or `/ID`. Numbers are rounded to 2 dp and never use exponent
  form or `-0`. `/CreationDate` is written only when the caller injects `info.creationDate`. Content streams are
  uncompressed, because FlateDecode through `CompressionStream` is async and its output is not guaranteed to be
  identical across runtimes.
- **Text** is WinAnsi (Latin-1 plus smart quotes, dashes, €, …) measured with the Adobe AFM widths. Anything else
  (CJK, emoji) becomes `?`. Fonts are never embedded, so the output is not PDF/A. Metadata uses UTF-16BE text strings.
- **Strokes** follow T031's `{ v, w, h, strokes }` shape (pad space, y down, `[x, y]` or `{ x, y }` points). They
  are fitted into the box with the aspect ratio kept and clamped to the pad. Malformed points are dropped, and a
  signature is capped at 20 000 points in total. When `w`/`h` are unusable, the points' own extent is used.
- **Validation:** `qpdf` is not installed here, so `tests/helpers/pdf-parse.ts` is a strict pure-JS checker. It
  checks xref offsets, stream lengths, the trailer and the page tree, every content-stream operator and its
  operand count, balanced BT/ET and q/Q, and that no number is in exponent form. A `qpdf --check` test runs
  automatically wherever `qpdf` is installed (skipped here). Poppler's `pdfinfo`/`pdftoppm` also open the
  5-page waiver cleanly (checked by hand).
- **Budget:** the 5-page, 2-signature waiver fixture (`tests/fixtures/pdf-waiver.ts`) is about 51 KB and takes
  about 1.4 ms per warm render on Node locally. Two tests cover it. One is a Node `process.cpuUsage()` test with a
  50 ms ceiling. The other, `tests/pdf.host.test.ts`, runs the render inside the Worker Loader sandbox through a
  new `pdf` route on the T007 budget fixture plugin and asserts `PLATFORM_BUDGET` (0 bridge calls, ≤ 50 ms).
- No dependencies were added. `@semics-tech/shared` is private, so there is no changeset.
- For T025: render once at completion, hash the returned bytes, then chunk them into `artifacts`. The certificate
  is just blocks (heading, table and paragraphs), so T025 owns its wording.
