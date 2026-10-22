# Phase 1 gate review: E-sign core and UI

Task T034 · reviewed 2026-10-22 · scope T020–T033, T112, T113, T115 (`packages/esign`, the e-sign pages of
`apps/playground`) against the E-sign PRD (ES-FR-*, ES-NFR-01..07), BUILD-PLAN §3.2/§3.4, R22–R36 and
`docs/protocol/esign-intent-v1.md`.

## Severity scale

| Severity | Meaning | Disposition |
| --- | --- | --- |
| 1 | Exploitable now: token, secret or PII disclosure, forged or replayed signature, data loss, a route over the 10-call limit | Fixed here, test first |
| 2 | Real weakness with impact: missing or wrong evidence, a protection that silently does not apply, a legal overclaim | Fixed here, test first |
| 3 | Defence in depth, evidence quality or protocol-conformance gap with no present exploit | Filed on a later task |
| 4 | Cosmetic, documentation, or a limit sitting exactly at its ceiling | Filed on a later task |

## Result

No Severity 1. Five Severity 2, all fixed test-first (findings 1-4 in 86be49c / 8b244de / 4d1e8fe; finding 22, CSRF, raised by the T057 review, in aedde7a and the following fix). Severity 3
and 4 are filed as acceptance criteria on T097, T100, T105 and the new T116. Nothing open at Severity 1 or 2 in E-sign.

## Findings

| # | Sev | Area | Finding | Disposition |
| --- | --- | --- | --- | --- |
| 1 | 2 | Audit evidence, rate limits | `callPublicRoute` built a fresh `Request` for the in-process handler with no user agent, no client-IP header and no `cf` object. Every ceremony submitted through `/sign/[token]` (the main path) wrote audit events and signer records **without IP or user agent**, and every per-IP limit collapsed into one site-wide `unknown` bucket: 20 `public/verify` calls per 10 minutes for the whole site, and the ceremony failure counter shared by all visitors | Fixed: pages pass `request: Astro.request`; the helper copies its headers except cookie, authorization, proxy-authorization, Referer (the sign page URL holds the token), `x-emdash-request` and body framing, and its `cf` (the host trusts `cf-connecting-ip` only with `cf`). R38. Events has the same pattern; T056 fixes it on its branch (IP headers only) |
| 2 | 2 | ES-NFR-07 claims | Default consent wording "…my electronic signature has the same legal effect as a handwritten one" claims what eIDAS Art. 25(2) gives only to qualified signatures; the product must never claim more than SES | Fixed: "I agree to use electronic records and an electronic signature for this document." in the manifest default, `DEFAULT_CONSENT_WORDING` and the e2e fixture; a test checks consent and certificate wording for overclaims. Version left at `1` (pre-release, nothing signed in the field). Lawyer review still due (T105 criterion) |
| 3 | 2 | Tamper evidence | Values the signer types into T033 signer fields were stored on the signer only: not in the signature hash, the audit chain or the signed PDF, so they could be changed afterwards undetected | Fixed: `bindSignature` hashes the values (key order) with the document and signature; the signed PDF prints them, labelled, before the signature block |
| 4 | 2 | R28 retention | `signatureSha256` (in the chain, kept after the purge) was an unsalted hash of `[docSha256, kind, typedName, strokes]`: after the purge a typed name could be confirmed by guessing, exactly what deleting `piiSalt` is meant to prevent | Fixed with #3: the hash is `SHA256(piiSalt ‖ …)`, so it stops being checkable once the salt is deleted |
| 22 | 2 | CSRF (from the T057 review) | EmDash 1.2 turns Astro's `security.checkOrigin` off and its own CSRF check covers only `/_emdash/api`, so the `/sign/[token]` sign and decline form posts and the `/verify` post were accepted from any site. Forging a signature still needs the token (it is in the path), but a page holding a leaked link could make the signer's own browser decline or sign, recording the signer's IP and user agent, and a cross-site `/verify` post spends the visitor's per-IP allowance | Fixed: local `isCrossSiteRequest` (`src/astro/lib/csrf.ts`, `Sec-Fetch-Site` first, then `Origin` against the page origin or the `Host` header, mirroring Events) runs before the form is read; a refused post gets `403`. `/signed/[token]` takes no posts |
| 23 | 4 | Budget (from the T057 review) | Events' drain could log its give-up as an 11th call. E-sign's cannot: a full tick is query + 6 sends + `putMany` = 8, the log makes 9 | Regression test added (`tests/emails.test.ts`); no change |
| 5 | 3 | Evidence quality | A GET of `/sign/[token]` performs the first view (`sent → in_progress`, `signer.viewed` with IP/UA). Mail scanners prefetch emailed links, so "Signer opened the document" can be a scanner | T116, T105 |
| 6 | 3 | Consent record | `signer.consented` records `consentVersion` but not the wording; the version identifies the text only if the admin bumps it on every edit | T116 |
| 7 | 3 | Audit actor | Admin events record `actor: "admin"`, not which user | T116 |
| 8 | 3 | Rate limit (R29) | The ceremony limiter counts failures after the lookup and never gates a lookup, so it does not slow guessing; harmless with 256-bit tokens, but R29 overstates it | T116 |
| 9 | 3 | Concurrency | Two interleaved runs of `intent-finish-<id>` can leave the signer's `tokenHash` and the queued invitation's token from different runs (dead link) | T116 |
| 10 | 3 | Error leakage | A thrown sandboxed-route error reaches public callers as `400 ROUTE_ERROR` with the raw message. Today only fixed strings | T100 |
| 11 | 3 | R28 retention scope | Personal data lives in more places than `audit_events.personal`: signer name/email/ip/ua/signature/fieldValues/declineReason, envelope `signer`, `fieldValues` (prefill) and `returnUrl`, nonces; the signed record (snapshot, PDF certificate with name and IP) keeps what it printed | T097, T105 |
| 12 | 3 | Protocol §8.1 | Any active template is accepted from an intent ("available to integrations" flag missing) | Already on T061 |
| 13 | 3 | Protocol §8.2 | Completion shows a plain "Return to the site" link; no `#receipt=` redirect yet | Already T062 (receipts) |
| 14 | 4 | Race | `envelopes/resend` repairs a missing `envelope.sent` without re-checking status; a racing decline could precede it in the chain | T116 |
| 15 | 4 | Input | `public/submit` accepts stroke points outside 0–1 (the PDF writer clamps them) | T116 |
| 16 | 4 | PDF | The PDF prints the snapshot's Markdown syntax raw while the ceremony renders it | T116 |
| 17 | 4 | Admin | Audit timeline table declares `audit.page` with no handler | T116 |
| 18 | 4 | Email | Invitation and completion links are relative when `ctx.site.url` is unset | T116 |
| 19 | 4 | Docs | `domain/audit.ts` header says a disclosed value can still be proven after the purge; R28 says it cannot | T097 |
| 20 | 4 | Rate limit | `from-intent` has no rate limit (malformed tokens cost 0 calls, unknown `cid` 2) | T100 |
| 21 | 4 | Budget | Two paths sit exactly at 10 calls: the `from-intent` inline retry after a terminal envelope and `decline` when its chain write loses a race (`session`'s first view reaches 9 the same way). Adding any call, a log line included, breaks them | Recorded (the from-intent retry is asserted at 10; the decline race path is counted by reading the code) |

## Checklist

### Public routes

| Route | Auth | Token handling | Rate limit | Replay | Responses |
| --- | --- | --- | --- | --- | --- |
| `public/envelopes/from-intent` | HMAC intent (`esign-intent/1`), §6 order via shared `verifyIntentToken` | intent in the POST body; signing token returned only for `delivery: inline` | none (finding 20) | nonce create-only write after every other check; `(cid, ref)` idempotent | ids and status only |
| `public/session` | signing token or copy token (R36) by SHA-256 index + constant-time compare | body only; `?token=` refused (`TOKEN_IN_QUERY`) | failure counter per IP (finding 8) | first view is a guarded transition | signer's own name, snapshot, consent, fields; download link only for the signer of a completed envelope; no salt, email or hashes |
| `public/submit` | signing token, pending signer | body only; `?token=` refused | failure counter | signer `pending` + guarded `in_progress → completed`; second submit `SIGNING_TOKEN_INVALID`/`ENVELOPE_CLOSED` | status, time, validated return URL |
| `public/decline` | signing token, pending signer | body only | failure counter | guarded transition | status, return URL |
| `public/download` | 15-min `signLink` (`esign/download`, param `e` only, HMAC key in KV) | no token in the URL; `?token=` refused | link expiry | idempotent read; bytes re-hashed against `pdfSha256` | stored bytes, `no-referrer`, `no-store`, `nosniff`, attachment |
| `public/verify` | none (public by design) | hash only | 20 / 10 min per IP (finding 1 fixed the bucket) | read only | matched, status, completion time, `finalHash`, `chainVerified`; no names, ids or salts |
| `otp/*`, `receipts/lookup`, `templates/catalog`, `self-serve/start` | stubs (`NOT_FOUND`, 0 calls) | — | — | — | — |

Logs: three `ctx.log.error` calls (PDF chunks mismatch, PDF job gave up, outbox gave up) carry only an envelope id
or a count. No token, secret, salt or PII is logged. URLs: tokens appear only in the `/sign/[token]` and
`/signed/[token]` paths; both pages and `/verify` send `Referrer-Policy: no-referrer` and `no-store`, and the
in-process call now drops the Referer header. The admin page never renders `tokenHash`, `piiSalt` or the master key
(existing tests).

### Budgets (every route and cron job is asserted)

| Path | Calls | Asserted in |
| --- | --- | --- |
| `from-intent` inline / email / replay / inline retry / email retry | 8 / 9 / 7 / 10 / 8 | `envelopes.routes.test.ts` |
| `intent-finish-<id>` | 8 | `envelopes.routes.test.ts` |
| `session` first view / later / completed / wrong token | 7 / 5 / 4 / 5 | `ceremony.routes.test.ts`, `download.routes.test.ts` |
| `submit` / two racing submits | 9 / ≤ 10 | `ceremony.routes.test.ts` |
| `decline` (chain retry worst case 10) | 7 | `ceremony.routes.test.ts` |
| `download` ready / pending / corrupt (+ log) | 3 / 3 / 4 | `download.routes.test.ts` |
| `verify` | 4 | `verify.routes.test.ts` |
| every declared public route with a bad request (stubs 0) | ≤ 8 | `manifest.test.ts` (T034) |
| `templates/*` | ≤ 2 | `templates.routes.test.ts` |
| `envelopes/create|get|list` / `send` | ≤ 8 / 9 | `envelopes.routes.test.ts` |
| `admin` interactions incl. resend, void, settings save, list paging | ≤ 8 | `admin.runtime.test.ts` |
| `signed-pdf-<id>` stored / re-arm / gave up (+ log) | 7 / 5 / 5 | `download.routes.test.ts` |
| `completion-email-<id>` | 5 | `emails.routes.test.ts` |
| `outbox-drain` (6 sends; + log when one gives up) / empty | 8 (9) / 1 | `emails.routes.test.ts` |
| `plugin:activate` | 1 | `emails.routes.test.ts` |

### Audit chain and retention (R28, ES-NFR-06)

The chain (`domain/audit.ts`, 100% branches) hashes salted commitments only; ids are `<envelope>:a<seq>` written
create-only, so the chain cannot fork; the PDF job and `public/verify` re-verify the chain and its head against
`finalHash`. Purge-then-verify is tested (`purgePersonal`). The retention job itself is T097 (Phase 6); this review
added what it must clear (finding 11) and closed the unsalted `signatureSha256` hole (finding 4).

### Ceremony CSP and sanitiser (ES-NFR-05)

`ceremonyCsp()`: `default-src 'none'`, scripts and the stylesheet by SHA-256 only, `connect-src 'self'` for the PDF
poll, `form-action 'self'`, `base-uri 'none'`, `frame-ancestors 'none'`. `/verify` has no `connect-src`. The snapshot
reaches the page only as the allowlisted tree of `lib/markdown.ts` (100% branches, XSS payload suite); the only
`set:html` uses are the package's own hashed script and style. Links are http(s)/mailto with `noopener noreferrer`.

### Signed PDF determinism (ES-FR-07/08)

Rendered once by the job from stored data (snapshot, signer, chain) with the deterministic T016 writer; the
creation date is `completedAt`; chunks are hash-addressed and the record is a guarded `pdfSha256: null` update; the
download re-hashes the stored bytes. The entered values (finding 3) are rendered in declared order, so the bytes
stay deterministic (test).

### Claims (ES-NFR-07)

Certificate: "signed with a simple electronic signature". Consent default fixed (finding 2). No "qualified",
"advanced", "tamper-proof" or handwritten-equivalence wording remains in code, manifest or pages (test).

## Task criteria

- **HTTP status from `toRouteError().status`.** EmDash 1.2's sandboxed JSON routes cannot set a status: a returned
  value is wrapped as `{ success: true, data }` with 200, a thrown error becomes 400 `ROUTE_ERROR` (only the host's
  own 503 codes keep a status; `getSandboxRouteErrorDetails`, `dispatchPluginApiRequest`). Only `response: "raw"`
  routes set one, and they drop the envelope every caller relies on (`callPublicRoute` in-process and fetch).
  Closed as not possible: refusals stay `{ ok: false, error: { code } }` in a 200 (R33), `public/download` (raw)
  already uses `toRouteError().status`, R37 records it and protocol §9 now says clients branch on `error.code`.
- **Admin envelope list paging.** `envelopes/list` takes `cursor`, returns `nextCursor`; the table pages with
  `envelopes.page:<status>` so the filter survives (test with 101 envelopes).
- **`signerFields` on the new-envelope form.** Multiline field, one per line `key: Label`, `*` for required;
  bad lines are passed through so `envelopes/create` refuses them visibly (test).
- **Coverage.** The ~54% overall line figure is real: v8 only sees modules a test imports. Routes, cron jobs and
  admin pages run inside workerd from the bundle `emdashPluginTest()` builds, so 355 host tests exercise them
  without a counted line (`routes/ceremony.ts` reads 8%, `admin/pages.ts` 14%). Making it count would need an
  istanbul-instrumented `backend.js` and collecting `__coverage__` from each sandbox isolate, which the test host
  does not offer. Decision: keep thresholds on directly imported code (domain 90% lines, audit and sanitiser 100%
  branches, all passing), keep routes thin, and rely on host tests with budget assertions for the rest; documented
  in `vitest.coverage.mjs`. There are no thresholds on `src/admin` in either package, so nothing there can fail on CI.
