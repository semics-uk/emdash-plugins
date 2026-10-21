---
id: T025
title: "E-sign: signed PDF at completion and download link"
phase: 1
package: esign
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T024, T016]
spec: [ES-FR-07, ES-FR-08]
---

# T025 · E-sign: signed PDF at completion and download link

## Definition

Build the signed PDF (document, signatures, certificate with audit table and hashes) once at completion, store it in chunks, record `pdfSha256`, and serve it byte-for-byte via a short-lived signed link. Fall back to a one-shot cron job if generation exceeds the budget.

## Model

**Opus 5.5**: Integrates PDF writer, storage chunking and budget fallbacks.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Downloaded bytes hash to `pdfSha256`
- [ ] Expired or altered links fail
- [ ] Large PDFs round-trip through chunked storage
- [ ] Over-budget generation is deferred to the job and completes

## Implementation (green, then refactor)

- `src/domain/pdf.ts`, `src/routes/download.ts`

## Acceptance criteria

- [ ] Certificate lists every audit event and the final hash
- [ ] Signed PDF stored in `artifacts` as 256 KiB base64 chunks (each document ≤ 512 KiB); replaces the `public/download` stub
- [ ] Download links use `signLink`/`verifyLink` (`@semics-tech/shared`, T011) with purpose `esign/download` and a secret of at least 32 bytes; the signing token never appears in the URL
- [ ] Render once at completion with `renderPdf` (T016), hash the returned bytes, chunk into `artifacts`; certificate wording owned here
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
