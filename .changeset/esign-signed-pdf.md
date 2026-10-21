---
"@semics-tech/emdash-esign": minor
---

Add the signed PDF: a one-shot `signed-pdf-<envelopeId>` cron job, scheduled by `public/submit` at completion, renders the document, the signature and a certificate of completion (every audit event, the audit head and `finalHash`) once, stores it in `artifacts` as 256 KiB base64 chunks and records `pdfSha256`. `public/download` serves the stored bytes through a 15-minute signed link (`esign/download`); `public/session` (for the signer of a completed envelope) and `envelopes/get` return that link once the PDF is ready.
