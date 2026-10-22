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
`public/submit` accepts only an `in_progress` envelope; a `sent` one is `SESSION_REQUIRED` (409, R31: the first view, `public/session` with `open: true`, does `sent → in_progress`), so there is no audit-head race or rebuild path.
Budget: from-intent is 8 calls inline and 9 with email delivery (create-only envelope write first; a retry after a declined/voided/expired envelope is 10 inline, and with email only stores a draft and schedules `intent-finish-<id>` (cron/intent-finish.ts, 8 calls), T113), submit is 9 (others ≤ 8).

Cron scheduling (T116, R37): `plugin:activate` never runs for a config-declared core, so admin `page_load`s,
`templates/create` and `public/verify` carry the shared `withScheduleCheck` (1 KV read; +1 the first time to queue
`ensure-schedules`, which schedules `outbox-drain` and `nonce-sweep`). Not on `from-intent`, `submit`, `session` or admin actions.
Adding a recurring task means adding it to `RECURRING_TASKS` in `src/plugin.ts` and bumping `SCHEDULES_FLAG` (shared, now v3).

Signing intents (T061): `src/routes/from-intent.ts`. Templates carry `integrations` ("available to integrations", head
only, default off, toggle on both template forms); `availableToIntegrations(head)` gates from-intent (else
`TEMPLATE_NOT_FOUND`, nonce already spent) and is what the T062 catalogue should list. `cron/nonce-sweep.ts`: hourly
`nonce-sweep` deletes `nonces` with `expiresAt < now`, oldest first, 3 pages of 100 (query + `deleteMany` each), and
schedules the one-shot `nonce-sweep-more` when a backlog remains (≤ 7 calls). `tests/from-intent.routes.test.ts` runs
all 53 intent vectors through the route: payload times shifted to the real clock and re-signed with the derived secret.

Receipts (T062): `domain/receipts.ts` mints `esign-receipt/1` deterministically from the stored envelope (only terminal
envelopes with `clientId` + `externalRef`; `at` = `completedAt`, else `closedAt` (decline and void write it), else
`updatedAt`); `routes/integration.ts` holds the shared client lookup (`integrationClients`: settings + client, 2 calls) and
`mintReceipt` (no calls). `public/submit`, `public/decline` and a closed `public/session` add `returnUrl` + `receipt` for
an integration's envelope (submit reads `settings.list()` instead of `get`, still 9; decline is 8). `/sign/[token]` answers
the sign/decline post with a 303 to `returnUrl#receipt=<token>` (`ceremonyRedirect`, `receiptReturnUrl` in `lib/sign.ts`);
a closed visit only shows the link. `public/receipts/lookup` (`routes/receipts.ts`, 3 calls: newest envelope of the pair by
attempt suffix, scoped to the cid) and `public/templates/catalog` (`routes/catalog.ts`, ≤ 5 calls: active heads filtered
with `availableToIntegrations`, `{ id, name, version }` sorted by name). `tests/vectors.ts` re-mints protocol vectors for
the real routes (time fields shifted, derived secrets); `tests/receipts.*.test.ts` cover all receipt, lookup and catalog
vectors. No rate limit on lookup/catalog (HMAC-authenticated, read-only, server-to-server).

Admin (T028): `src/admin/pages.ts` + private `admin` route (`routes/admin.ts`); pages `/envelopes`, `/templates`,
`/settings` in the manifest. Actions go through the private routes, plus `envelopes/resend` (fresh token + queued
invitation for a `sent` envelope whose `invite-<signerId>` outbox row is missing/failed; appends a missing `envelope.sent`
event, audit seq starts at 0) and `envelopes/void`. `send` is 9 calls, so the admin answers it with a small
confirmation instead of re-reading. The sandbox cannot read the env: the encryption banner shows after a failed
secret save or when a stored secret is unreadable.

`src/astro/lib/*.ts` is exported as `./astro/lib/*` (T065): the suite embeds the ceremony on its own page with
`handleSign`, `ceremonyRedirect` and `ceremonyCsp` from there. Treat their signatures as public API.

UI (T029-T030): `/sign/[token]` = `SignPage.astro` → `handleSign` (`src/astro/lib/sign.ts`) → `<SigningCeremony>`.
The snapshot is rendered only via `lib/markdown.ts` (allowlisted tree, `{text}` output, http(s)/mailto links; 100%
branches). The page's CSP is `ceremonyCsp()`: only the inlined `src/client/ceremony.js` (plain JS, `?raw`) and
`CEREMONY_CSS`, by hash; any new client script must be added there. Pad strokes go in the hidden
`signatureStrokes` input as `{ v, w, h, strokes }` and are normalised to 0-1 points for `public/submit`.

Verify + signed copy (T032): `/verify` = `VerifyPage.astro` → `<VerifyDocument>`; `src/client/verify.js` (inlined as `VERIFY_SCRIPT`, hashed with `VERIFY_CSS` into `verifyCsp()`, no `connect-src`) hashes a chosen/dropped PDF with WebCrypto and submits only `sha256`. `/signed/[token]` = `SignedCopyPage.astro` → `handleSignedCopy` (token POSTed to `public/session`, fresh `download` each visit); the completion email cron (`cron/completion-email.ts`) rotates the signer's token and links it (5 calls), never the 15-minute `downloadLink`.

Pad (T031): `src/client/pad.js` (inlined, hashed as `PAD_SCRIPT`, second `script-src` hash) fills `[data-esign-pad-slot]` with a canvas, Undo and Clear and writes `{ v: 1, w: 600, h: 200, strokes }` (whole-pixel points, max 64 strokes / 1500 points) to `signatureStrokes`. `PublicRouteContext.pluginId` makes `handleSign` call the integration's configured core id.

Signer fields (T033): `envelopes/create` takes optional `signerFields: [{ key, label, required? }]` (max 16, stored on
the envelope); `public/session` returns them as `fields`; `public/submit` rejects undeclared keys and missing required
ones (`BAD_REQUEST`, issue `fieldValues.<key>`) and stores the values on the signer.

Phase 1 review (T034, `tasks/reviews/phase-1.md`): `bindSignature(docSha256, signature, { fieldValues, salt })` hashes
`piiSalt ‖ JSON([docSha256, kind, typedName, strokes, [[key, value]…]])`, so the entered values are covered and a purged
name cannot be guessed (R28); the signed PDF prints the entered values under "Details entered by the signer". Pages pass
`request: Astro.request` to `callPublicRoute`, which copies the visitor's headers (minus cookie, authorization, Referer,
body framing) and `cf` onto in-process calls (R39): without it `requestMeta` has no IP or user agent. JSON routes cannot
set an HTTP status in the sandbox (R38). `envelopes/list` takes `cursor` and returns `nextCursor`; the admin table's page
action is `envelopes.page:<status>`. Coverage counts only code imported by tests, not code run inside workerd. `/sign/[token]` and `/verify` refuse cross-site posts with `lib/csrf.ts` (EmDash sets `checkOrigin` off).

Integrations (T060): `/integrations` page (`src/admin/integrations.ts`, `domain/clients.ts`). `client.create` returns the pairing string in that one response (a `code` block) and nothing can show it again; the `clients` doc holds `name, clientId, createdAt, lastUsedAt, revokedAt, returnUrlAllowlist` and no secret (derived per S8). `client.revoke` sets `revokedAt` once (`updateIf` on `revokedAt: null`). Master-key rule: `masterKeyBytes` unchanged (trimmed UTF-8, >= 32 bytes); `integrations.generate-key` sets 32 CSPRNG bytes as base64url, only while no key is set (changing it re-pairs every client); the settings save refuses a typed key under 32 bytes. Allowlist lines follow protocol §7 (https, http only for loopback, no userinfo/query/fragment, max 10). Page load 2 calls, actions 3. Admin actions ride EmDash's own admin API (CSRF-protected); no public route.

Hardening (T117, `tasks/reviews/phase-1.md` findings 5-9, 14-18): `public/session` records the first view only with
`open: true`; the sign page sends it with its first POST (sign or decline), never on a GET (mail scanners). Session
returns `consent.sha256`; submit requires `consentSha256` (`INVALID_CONSENT_HASH`; `CONSENT_CHANGED` when the wording
changed since) and records it on `signer.consented`, the signer and the certificate. Stroke points must be in 0-1.
The ceremony limiter is one per-IP counter (scope `ceremony`) for session, submit and decline; session reads it before
the lookup (R29). Session reads `settings.list("consent")`; submit reads that, or `settings.list()` for an integration
envelope; session and decline `settings.get("integrationMasterKey")` only for an integration envelope (no decrypt
otherwise; `envelopes/send` still reads `settings.list()`). Budgets: session 5 / first view 8 / wrong token 4; submit 9;
decline 7 (8 with a master key). Admin events carry `data.userId` from `routeCtx.user` (the admin route passes it to
the envelope routes). Resend writes a missing `envelope.sent` create-only at seq 1 (after `envelope.created`), so a
racing event keeps that place (7 calls). `intent-finish` derives the invitation token as
`HMAC(masterKey, "esign-invite/1." + id)`. The signed PDF is rendered from `parseSnapshot` (`src/astro/lib/markdown.ts`,
imported by the core: pure, no imports). Without `ctx.site.url`, `queueInvitation`/`queueCompletion` queue nothing and
return null; send answers `invitation: "SITE_URL_MISSING"`, resend refuses, and the admin shows `SITE_URL_WARNING`. The
audit timeline's page action is `audit.page:<id>`.

Retention (T097, R45): `src/cron/retention.ts`. Daily `retention` (`23 3 * * *`, in `RECURRING_TASKS`; shared flag now v5)
plus one-shot `retention-more`; state in KV `cron:retention`. A pass computes the cutoffs from `settings.list("retention")`,
then runs phases `personal` (personal-data period), `records` (signed-records period) and `outbox` (sent/failed rows older than
the personal period). Envelopes are paged 10 at a time by `createdAt` (no `orderBy`, so the storage cursor survives deletes),
with a per-phase floor (`pf`/`rf`: the oldest envelope a pass had to leave) so a pass never rescans done envelopes; each page
takes two ticks (audit events first, then signers + envelopes), every tick ≤ 8 calls. Purged envelopes carry
`personalPurgedAt` (no `piiSalt`); tombstones carry `recordsPurgedAt` (`pdfSha256: null`, so `/verify` is `matched: false`,
`public/download` is `ENVELOPE_NOT_FOUND`, the PDF job skips purged envelopes). Admin: "Delete personal data" form on
`/envelopes` (`retention.preview` 2 calls, `retention.erase` 8) via `findForErasure` + `eraseOnRequest`.
`toIso(ms?)` (shared `time.ts`) is the one ISO-time helper; use it instead of `new Date(x).toISOString()` (bundle, R42).
Expiry (T092, R46): `src/cron/expire.ts`. Hourly `expire` (`17 * * * *`, in `RECURRING_TASKS`; shared flag now v6) plus one-shot
`expire-more`: one query (`status in [sent, in_progress]`, `expiresAt < now`, oldest first, 2 per tick), then per envelope
`transitionEnvelope(... "expired")` + `envelope.expired` audit event (3 calls, 8 per tick with the continuation). A signer who
completes first wins (the guarded update loses; nothing is audited). Reminders are Pro: Free has no reminder code, only the
`reminderCadenceDays` setting. Envelopes carry a lowercase `signerEmail` (indexed, set in `draftDoc`, cleared by `scrubEnvelope`) so
`findForErasure` finds drafts by email; it queries `signers` and `envelopes` in parallel (2 calls) and reads the envelopes only
for signer hits it did not already get. Decline and void need nothing more (T024/T028/T117).
E-sign Free backend after T092: 103.9 KiB of 104 (admin notices go through `note/info/warn/error`, `toEnvelopes()`/`openEnvelope()`).

Several signers (T090, ES-FR-15; the routing is Pro, Free only keeps such envelopes safe). An envelope has 2-10
`signerIds` (`<id>:s<order>`, signer 1 is also `envelope.signer`) and `routing: "parallel" | "sequential"`. Free, generically:
`public/session` records each signer's own first view once (guarded `viewedAt` on the signer, +1 call: 9 for the view that
also opens the envelope), `signer.viewed`/`signer.declined` carry `data.signer = order` (only when there are several, so
one-signer hashes are unchanged; `signerData` in `domain/signing.ts`); a decline by any signer closes the envelope; a signer
who signed an open envelope gets `state: "closed", status: "in_progress"`, which the sign page shows as waiting (SU-FR-11:
`SignView` `waiting`, and `signed` with `waiting: true` when submit answers `status: "in_progress"`); the signed-PDF job
`getMany`s every signer and `signedPdfDocument({ signers })` prints each one's signature, entries ("Details entered by
<name>") and certificate group ("Signer 1", "Signer 2"; one signer keeps the old layout and bytes) and "signer N" as the
actor of their events. `public/submit` on such an envelope stops after the settings read: Free answers `ENVELOPE_CLOSED` and
writes nothing (a downgrade never completes a half-signed envelope, R44 principle); a Pro build passes a step to
`ceremonyHandlers(step)` (`src/seams.ts`) and gets `{ envelopeId, envelope, signer, set, now }`, `set` being the signer's
signed record. `SIGNING_OUT_OF_TURN` is the shared code for a sequential signer whose turn has not come. Pro mails every
message to a signer under the outbox id `invite-<signerId>` (invitation, reminder, completion), so erasure covers them.
E-sign Free backend after T090: 104.6 KiB of 112 (R47).

Email one-time code (T091, ES-FR-16; the code itself is Pro, Free only enforces it). An envelope may carry `otp: true`; a signer
carries `otpVerifiedAt`. Free `public/submit` refuses `envelope.otp && !signer.otpVerifiedAt` (`OTP_REQUIRED`, 403, after the
expiry check, no extra call, nothing written) and `public/session` answers `otp: "required" | "verified"` for such an envelope,
so a downgrade never lets an unverified signer through (the Free `public/otp/*` routes stay `NOT_FOUND` stubs, so such an
envelope waits for Pro, as T090's does). `onEnvelopeSend(fn)` (`seams.ts`, `routes/envelopes.ts`) lets an edition stamp fields on
an envelope as `envelopes/send` freezes it, from the settings that route already read (Pro stamps `otp`). The certificate adds
"Identity check: Email one-time code verified" per signer with `otpVerifiedAt`. The sign page (`lib/sign.ts`, `SigningCeremony.astro`)
shows "Email me a code" and a code box instead of the signing form while `session.otp === "required"` (intents `otp-send` and
`otp-verify`; the code only in the POST body); UI messages for `OTP_*` codes live in `MESSAGES`. Shared adds `OTP_REQUIRED`; Pro's
other codes (`OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `OTP_WAIT`, `OTP_SEND_FAILED`, `OTP_NOT_REQUIRED`) are built by Pro.

Self-serve block (T093, ES-FR-18, SU-FR-12, R50; the route is Pro, the block is MIT source and ships in Free). The `esign-request` Portable
Text block (`src/astro/SelfServeBlock.astro`, `lib/self-serve.ts`; descriptor field `template` = template id) calls
`public/self-serve/start` with `describe: true`; Free's route is the NOT_FOUND stub, so on Free (or a template that is not
offered, or no Turnstile keys) the block renders `esign-request-unavailable` and no form. Ready, it renders a no-JS form
(name, email, the template's `field:<key>` inputs, a hidden `website` honeypot, a Turnstile widget when a site key is set)
posting to the injected `POST /_esign/start` (`self-serve-endpoint.ts`: `isCrossSiteRequest` first, then the route, then a 303
back to the page with `esign_start=sent|<CODE>&esign_t=<templateId>`; values are never put in the redirect). The block never
imports `@semics-tech/shared` (R35). The start answers `check_email` only: the signing link is emailed, never shown (R50).

Uploaded PDFs (T094, ES-FR-19, R53; uploading, sending and stamping are Pro, Free only keeps such envelopes safe). An envelope may
carry `document: { kind: "pdf", name, bytes, pages, ... }` (Pro keeps its chunk ids and field layout there too) with `snapshot: null`;
its `docSha256` is the uploaded file's SHA-256. `public/session` then reads no snapshot (4 calls) and answers `snapshot: ""` and
`document` with only `kind`, `name`, `bytes`, `pages`; Pro adds `document.view` (a link). `public/submit` refuses such an envelope
with `ENVELOPE_CLOSED` (nothing written) unless built with a `ceremonyHandlers` step (Pro's); decline works. Free's signed-PDF job
skips it (no snapshot). The sign page (`pdfDocumentView` in `lib/sign.ts`) shows the file's name, pages, size and SHA-256 with links
to open or download it, never an embed (raw plugin responses carry `CSP: sandbox`, under which browser PDF viewers do not run in
frames; the page CSP stays frame-free), and no signing form while there is no same-site link.
E-sign Free backend after T094: 105.0 KiB of 112 (R47).
