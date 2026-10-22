# E-sign package context

Read this instead of BUILD-PLAN.md; open a BUILD-PLAN section only when your task's `spec` cites it.

## What it is

`@semics-tech/emdash-esign`: sandboxed core `semics-esign` (`emdash-plugin.jsonc`, `src/plugin.ts`) plus a
native UI (`src/ui`, `src/astro`, `src/client`, `src/integration`) providing `/sign/[token]` and `/verify`.
Simple electronic signatures only (ESIGN/UETA, eIDAS SES); never claim more. E-sign never imports Events.

Free: templates, one signer, typed/drawn signatures, consent, audit chain, signed PDF + certificate,
verify page, retention, decline and void, the integration protocol. Pro: several signers, OTP,
automatic reminders/expiry, PDF templates, self-serve forms, bulk send, MCP (BUILD-PLAN §13).

## Trust contract (frozen at 1.0)

- Capabilities: `email:send`, `media:read`, `media:bytes:read`, `network:request`.
- Allowed hosts: `challenges.cloudflare.com`.
- Public routes (all declared now): `envelopes/from-intent`, `session`, `otp/send`, `otp/verify`,
  `submit`, `decline`, `download`, `verify`, `receipts/lookup`, `templates/catalog`, `self-serve/start`.

## Storage collections

`templates`, `envelopes`, `signers`, `snapshots`, `artifacts` (signed PDF chunks, 256 KiB base64),
`audit_events`, `clients`, `nonces`. Every document ≤ 512 KiB.

## Rules that bite

- Snapshot frozen at send; `docSha256` = SHA-256 of the canonical snapshot text (shared `template.ts`).
- Audit chain: `hash_n = SHA256(hash_n-1 ‖ event)` over **salted commitments** of personal fields, so the
  retention purge never breaks verification.
- Signed PDF built **once** at completion, stored, `pdfSha256` recorded; download returns the stored
  bytes; a one-shot cron job finishes generation if it would exceed the CPU budget.
- Integration protocol: `docs/protocol/esign-intent-v1.md` is binding (check order, error codes,
  nonce rules, return-URL allowlist). 102 vectors in `docs/protocol/vectors.json`.
- Client secrets: derived as `HMAC-SHA256(integrationMasterKey, "esign-client/1." + clientId)`; the master
  key is the one declared secret field. No dynamically named secrets (S8). Secrets need
  `EMDASH_ENCRYPTION_KEY`; show a banner when it is missing.
- Errors through `toRouteError` from `@semics-tech/shared`; tokens never in URLs except the emailed
  `/sign/[token]` page path, which sends `Referrer-Policy: no-referrer` and POSTs the token.

## Where things live

`src/domain` pure logic (90% lines; 100% branches for audit and signing) · `src/routes` thin adapters ·
`src/storage/schema.ts` · `src/admin` Block Kit · `src/cron` · `tests/`.

Modules so far: `domain/templates.ts` (T021: head + immutable `<id>:v<n>` versions), `domain/state.ts` (T022: the
status table and `transitionEnvelope`, a guarded `updateIf` on the expected status; every status change, route or
cron, goes through it), `domain/envelopes.ts` (T022: drafts, `sendEnvelope` freezes the canonical snapshot +
`docSha256`, hash-addressed snapshot chunks, signer `tokenHash` only), `routes/envelopes.ts` (T022: private
`envelopes/create|send|get|list` and `public/envelopes/from-intent`), `domain/audit.ts` (T023: the chain. Event
ids `<envelopeId>:a<seq 6 digits>`; personal fields (name, email, participant, ip, ua) are hashed only as
`SHA256(piiSalt ‖ value)` commitments, raw values in `personal` outside the hash, purged with `purgePersonal`;
each envelope's random `piiSalt` is stored on it and stripped from route responses. Append a later event with
`appendAuditEvent` (head query + create-only CAS = 2 calls, retries once); a fresh envelope's opening events go
in one `putMany` via `initialAuditEvents`. `verifyAuditChain(id, events, { salt, head })` for the certificate;
`finalEnvelopeHash(docSha256, head)` is the envelope's `finalHash`. Held to 100% branches in `vitest.config.ts`).
`domain/pdf.ts` + `cron/pdf.ts` + `routes/download.ts` (T025: `public/submit` schedules the one-shot cron task
`signed-pdf-<envelopeId>` (task names: letters, digits, `-`, `_`); the job verifies the chain ends at `finalHash`
(else re-arms a minute later, gives up after 5), renders document + signature + certificate (`CERTIFICATE_WORDING`,
every audit event, head, `finalHash`) with `renderPdf`, writes hash-addressed `artifacts/<id>:pdf:<sha16>:<i>`
chunks and sets `pdfSha256` + `pdf: { ids, bytes }` with a guarded `updateIf` on `pdfSha256: null`.
`public/download` is a `response: "raw"` route: a 15-min `signLink` (`esign/download`, param `e` only; HMAC key 32
random bytes, hex, in KV `esign:download-link-key`), returns the stored bytes after re-checking `pdfSha256`;
`SIGNED_PDF_PENDING` (409) re-arms the job. Links come from `public/session` (signer of a completed envelope:
`pdf: "pending" | "ready"`, `download`) and `envelopes/get`).
`public/submit` accepts only an `in_progress` envelope; a `sent` one is `SESSION_REQUIRED` (409, R31: the first view, `public/session`, does `sent → in_progress`), so there is no audit-head race or rebuild path.
Budget: from-intent is 8 calls inline and 9 with email delivery (create-only envelope write first; a retry after a declined/voided/expired envelope is 10 inline, and with email only stores a draft and schedules `intent-finish-<id>` (cron/intent-finish.ts, 8 calls), T113), submit is 9 (others ≤ 8).

Admin (T028): `src/admin/pages.ts` + private `admin` route (`routes/admin.ts`); pages `/envelopes`, `/templates`,
`/settings` in the manifest. Actions go through the private routes, plus `envelopes/resend` (fresh token + queued
invitation for a `sent` envelope whose `invite-<signerId>` outbox row is missing/failed; appends a missing `envelope.sent`
event, audit seq starts at 0) and `envelopes/void`. `send` is 9 calls, so the admin answers it with a small
confirmation instead of re-reading. The sandbox cannot read the env: the encryption banner shows after a failed
secret save or when a stored secret is unreadable.

UI (T029-T030): `/sign/[token]` = `SignPage.astro` → `handleSign` (`src/astro/lib/sign.ts`) → `<SigningCeremony>`.
The snapshot is rendered only via `lib/markdown.ts` (allowlisted tree, `{text}` output, http(s)/mailto links; 100%
branches). The page's CSP is `ceremonyCsp()`: only the inlined `src/client/ceremony.js` (plain JS, `?raw`) and
`CEREMONY_CSS`, by hash; any new client script must be added there. Pad strokes go in the hidden
`signatureStrokes` input as `{ v, w, h, strokes }` and are normalised to 0-1 points for `public/submit`.
