---
id: T026
title: "E-sign: hash verification route"
phase: 1
package: esign
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T025]
spec: [ES-FR-09, ES-US-6]
---

# T026 · E-sign: hash verification route

## Definition

`public/verify` takes `{ sha256 }` and reports whether it matches a completed envelope's `pdfSha256`, with no personal data.

## Model

**Sonnet 5.5**: Small route.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Known hash returns matched with date and status
- [x] Unknown hash returns not matched
- [x] Response has no names or emails
- [x] Rate-limited

## Implementation (green, then refactor)

- `src/routes/verify.ts`

## Acceptance criteria

- [x] Within budget
- [x] Completion uses `appendAuditEvent`, sets `finalHash = finalEnvelopeHash(docSha256, head)`; verification passes the recorded head to `verifyAuditChain` (T023)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- `src/routes/verify.ts`: `public/verify` takes `{ sha256 }` (64 hex, any case; else `BAD_REQUEST`). Unknown or non-completed: `{ ok, matched: false }`. Match: `{ matched, status, completedAt, finalHash, chainVerified }`; no names, emails, ids, salts or tokens. Rate limit 20 per 10 min per IP (`rateLimit`, scope `esign-verify`).
- Budget: 4 bridge calls (limiter 2, envelope by `pdfSha256` 1, events 1). Chains over 100 events are not checked (`chainVerified: null`).
- Added `pdfSha256` to the `envelopes` indexes (`schema.ts`, `emdash-plugin.jsonc`) so the lookup is indexed; storage sample and manifest stub test updated.
- Acceptance 2 was already met by T024/T025: completion appends via the chain primitives (`extendAuditChain`/`writeAuditEvents`, in one batch) and sets `finalHash = finalEnvelopeHash(docSha256, head)`. The head is stored only folded into `finalHash`, so verification runs `verifyAuditChain` and checks `finalEnvelopeHash(docSha256, head) === finalHash` (same as the PDF job) instead of passing `head` to it.
