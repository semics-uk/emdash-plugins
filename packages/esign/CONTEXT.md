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
`envelopes/create|send|get|list` and `public/envelopes/from-intent`).
