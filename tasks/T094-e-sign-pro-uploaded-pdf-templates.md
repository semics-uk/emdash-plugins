---
id: T094
title: "E-sign Pro: uploaded PDF templates"
phase: 6
package: esign
edition: pro
status: done
model: opus-5.5
size: L
depends_on: [T067, T110, T071]
spec: [ES-FR-19, Spike S5]
---

# T094 · E-sign Pro: uploaded PDF templates

## Definition

Read uploaded PDFs (`media:bytes:read`), stamp fields at entered coordinates, store the result and its hash; stamping runs in the sandbox or the UI layer per Spike S5.

## Model

**Opus 5.5**: PDF manipulation under CPU limits.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Stamped output opens and shows fields at the right coordinates
- [x] Hash recorded by the core
- [x] Over-limit PDFs rejected with a code

## Implementation (green, then refactor)

- `src/domain/pdf-templates.ts`

## Acceptance criteria

- [x] Decision recorded
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```

## Notes

- **Decision (BUILD-PLAN R53, supersedes R25's pdf-lib allowance):** pdf-lib (~523 KB) cannot fit the Pro E-sign backend, so Pro
  stamps with its own minimal reader and incremental-update writer (`src/pdf/read.ts`, `src/pdf/update.ts` in the Pro repo), in
  the sandbox. The signed PDF is the uploaded file, byte for byte, followed by one update (stamps on the original pages, then the
  certificate pages from Free's certificate with PDF wording). `docSha256` = SHA-256 of the upload; `pdfSha256` of the whole file
  (recorded by the same guarded update as Free's, so `/verify` and downloads are unchanged).
- **Where the code is:** Pro repo (`packages/esign-pro/src/domain/pdf-templates.ts` as the task names, `src/pdf`, `src/pdftemplates`,
  `src/admin/pdf-templates.ts`; `pro.json`: collections `pdf_templates`, `pdf_files`, page `/pdf-templates`). Public repo: the
  smallest MIT seam: `EnvelopeDoc.document`, `public/session` describes it without reading a snapshot, `public/submit` refuses it
  without the edition's step (Free never signs a PDF it cannot show or stamp), and the sign page's PDF panel (open/download
  links, `pdfDocumentView`). Free E-sign backend 104.8 -> 105.0 KiB.
- **Measured** (local workerd harness, R27): Pro E-sign backend 152.9 -> 187.9 KiB (ceiling 256), cold start 5.7 ms. Upload and
  render about 7 ms CPU per MiB + 2 ms on a cold isolate (4 MiB: 29-32 ms); cap set to 3 MiB (22-25 ms) for 2x headroom, so one
  invocation suffices and no cron split was needed. Calls: upload 5, update 3, send 7, session 5 (first view 8), document link 3,
  render 7.
- **Ceremony display:** links to open or download the PDF, no embed. EmDash serves raw plugin responses with
  `Content-Security-Policy: sandbox; default-src 'none'` + nosniff (nothing in the file runs in the site origin), and browsers' PDF
  viewers do not run in sandboxed frames; page images would need a renderer far over budget. Uploads with JavaScript, Launch, XFA,
  RichMedia, SubmitForm or ImportData names are refused.
- **Scope left for follow-ups:** one signer per PDF send (the stamping, certificate and routing job already handle several signers
  and `signer=<n>` fields; a several-signer PDF send needs a route like `pro/envelopes/send` for PDF templates); PDF templates are
  not offered to integrations, self-serve or bulk send; uploaded files are never garbage-collected; no e2e (the playground runs Free,
  where a PDF envelope cannot be signed; the UI is covered by `tests/ui/ceremony.test.ts` and the Pro editions tests cover the routes).
- TDD: the Pro admin page test was added with the admin page (after the test commit); everything else was seen failing first.
