---
id: T025
title: "E-sign: signed PDF at completion and download link"
phase: 1
package: esign
edition: free
status: review
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

- [x] Downloaded bytes hash to `pdfSha256`
- [x] Expired or altered links fail
- [x] Large PDFs round-trip through chunked storage
- [x] Over-budget generation is deferred to the job and completes

## Implementation (green, then refactor)

- `src/domain/pdf.ts`, `src/routes/download.ts`

## Acceptance criteria

- [x] Certificate lists every audit event and the final hash
- [x] Signed PDF stored in `artifacts` as 256 KiB base64 chunks (each document ≤ 512 KiB); replaces the `public/download` stub
- [x] Download links use `signLink`/`verifyLink` (`@semics-tech/shared`, T011) with purpose `esign/download` and a secret of at least 32 bytes; the signing token never appears in the URL
- [x] Render once at completion with `renderPdf` (T016), hash the returned bytes, chunk into `artifacts`; certificate wording owned here
- [x] The certificate prints the audit head and `finalHash` (T023)
- [x] Builds on T024: envelope `completed`, `finalHash` set, `signature.sha256 = SHA256(JSON([docSha256, kind, typedName|null, strokes|null]))`; generate the PDF in cron if the submit route has no budget left (it uses 8 calls)
- [x] Meets the Definition of Done in `tasks/README.md`

## Notes

- **Always deferred, never inline.** Submit had no budget left, so every PDF is rendered by the one-shot
  cron task `signed-pdf-<envelopeId>` (`src/cron/pdf.ts`). Submit schedules it, which brings submit to
  **9 bridge calls** (hard limit 10, like from-intent). The ceremony tests now allow 9 for submit. Submit's
  rare audit-race path was already over 10 (8 + 4) and is now 13. That is T024's existing path and is not
  changed here.
- The job (6 calls) checks that the chain verifies and ends at the head that `finalHash` covers. If it
  doesn't yet (submit still writing, or correcting `finalHash`), the job re-arms a minute later and gives up
  with a log after 5 attempts. `pdfSha256` is recorded with `updateIf` where `pdfSha256: null`, so it is
  set only once. Chunk ids are hash-addressed, so a duplicate run can only rewrite the same bytes.
- Cron task names allow only letters, digits, `-` and `_` (the host rejects `:`), and envelope ids fit
  that rule.
- Download link: `signLink` with purpose `esign/download`, a 15-minute TTL and the param `e` (envelope id)
  only. The HMAC key is 32 random bytes stored as hex in KV `esign:download-link-key` and created on first
  use with a create-only write. Links are minted by `public/session` (the signer of a completed envelope
  gets `pdf: "pending" | "ready"` and `download: { url, expiresAt }`) and by admin `envelopes/get`. The URL
  is site-relative (`/_emdash/api/plugins/<id>/public/download?...`). The submit response has no link
  because the PDF isn't ready yet; the ceremony UI should poll `public/session`.
- `public/download` is a `response: "raw"` route: it returns the stored bytes after re-checking
  `pdfSha256`, and JSON error bodies for failures. If the PDF isn't stored yet it returns the new registry
  code `SIGNED_PDF_PENDING` (409) and re-arms the job, which covers a lost one-shot.
- Shared changes: `sha256Hex` now also accepts `Uint8Array` (needed to hash PDF bytes; the string
  behaviour is unchanged), and `SIGNED_PDF_PENDING` was added to `ERROR_CODES`.
- I added a unit test for `writeAuditEvents`: the esign coverage gate failed on the 100% branch
  threshold for `audit.ts` (single-event batch branch) without it.
- Follow-ups: T027 (completion email) can call `downloadLink(ctx, id, now)` and prefix the site URL. The
  retention purge must keep `artifacts`, because the signed PDF is the signed record.

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
