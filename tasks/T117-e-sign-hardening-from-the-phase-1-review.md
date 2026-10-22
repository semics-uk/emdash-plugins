---
id: T117
title: "E-sign: hardening from the Phase 1 review"
phase: 6
package: esign
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T034]
spec: [ES-FR-04, ES-FR-05, ES-NFR-02, R29]
---

# T117 · E-sign: hardening from the Phase 1 review

## Definition

The Severity 3 and 4 findings of the Phase 1 gate review (`tasks/reviews/phase-1.md`) that no other task
owns. None is exploitable today; each weakens evidence quality, defence in depth or consistency.

## Model

**Opus 5.5**: Audit evidence and token handling, each inside the 10-call budget.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] A GET of `/sign/[token]` (a mail scanner's prefetch) records no `signer.viewed` event; the first view is recorded by a POST (the "Review and sign" step, or the first form post), so the `sent → in_progress` transition (R31) never happens on a GET
- [x] `signer.consented` records the SHA-256 of the consent wording that was shown (not only `consentVersion`, which identifies the text only if the admin remembers to bump it), within the submit budget (9)
- [x] Admin audit events (`envelope.created|sent|voided`) record the acting user's id from `routeCtx.user` (not the email), not only `actor: "admin"`
- [x] `envelopes/resend` appends a missing `envelope.sent` only while the envelope is still `sent` (a decline racing a resend cannot leave `envelope.sent` after `envelope.declined`)
- [x] Two concurrent `intent-finish-<id>` runs cannot leave the signer's `tokenHash` and the queued invitation's token out of step (write the signer and the invitation from one token chosen deterministically per envelope, or make the guarded `draft → sent` update the first write)
- [x] `public/submit` rejects stroke points outside 0–1 (the pad normalises to 0–1; the PDF writer clamps, so today they only distort the drawing)

## Implementation (green, then refactor)

- `src/routes/ceremony.ts`, `src/astro/lib/sign.ts`, `src/routes/envelopes.ts`, `src/cron/intent-finish.ts`, `src/domain/signing.ts`

## Acceptance criteria

- [x] R29's "wrong tokens are rate-limited per IP" is accurate: the ceremony limiter counts failures after the lookup and never gates one, so it does not slow guessing (256-bit tokens make guessing moot). Either gate the lookup where the budget allows (session 7 → 8; submit is at 9, so not there) or reword R29 and the `ceremony.ts` header
- [x] The signed PDF renders the snapshot's Markdown (emphasis, lists, links as text) the way the ceremony shows it, instead of the raw syntax; the bytes stay deterministic
- [x] The audit timeline table's `audit.page` action has a handler or the table drops paging (a Free chain is a handful of events; 200 are shown)
- [x] Invitation and completion emails refuse to queue a relative link when `ctx.site.url` is unset (today the link is `/sign/<token>`), and the admin shows why
- [x] Budgets unchanged or lower; asserted with `expectWithinBudget`
- [x] Signing must not depend on decrypting secrets when the envelope has no integration: `public/session`, `submit` and `decline` read only the non-secret settings they need, and decrypt the master key only for integration envelopes, so a missing or changed `EMDASH_ENCRYPTION_KEY` never blocks a plain signature (T062 review)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```

## Notes

Tests: `tests/hardening.routes.test.ts` (runtime host, one block per finding), `tests/resend-race.test.ts` (the resend
race replayed in-process with an in-memory store, since the sandbox cannot schedule a decline inside resend's window),
plus additions to `signing.domain`, `pdf.domain` and `ui/sign`. All were seen failing for the stated reason (3626fe2);
the concurrent `intent-finish` test passed before the fix too (the host did not interleave the runs), so the
deterministic "a second run picks the same token" test is the one that proves finding 9.

- **First view (finding 5).** `public/session` transitions and writes `signer.viewed` only with `open: true`. The sign
  page sends it with its first POST (sign or decline); a GET renders the document but records nothing, and the
  post-sign re-read and the PDF poll only look. No extra click: the "first form post" option of the criterion. R31
  holds (submit still needs `in_progress`); R31's row now says so.
- **Consent (finding 6).** Session returns `consent.sha256`; submit now requires `consentSha256` (a contract change of
  `public/submit`, which is not part of the integration protocol), refuses `CONSENT_CHANGED` when the wording changed
  after it was shown, and records the hash on `signer.consented`, the signer and the certificate. Submit stays at 9.
- **Admin actor (finding 7).** `actor` stays `"admin"`; `data.userId` carries `routeCtx.user.id` (the admin route passes
  the host-authenticated user into the envelope routes). Never the email.
- **R29 (finding 8).** Gated where the budget allows: session reads the counter before the lookup (first view 7 → 8,
  wrong token 5 → 4). The three routes now share one counter (scope `ceremony`), so failures on submit/decline also gate
  the session. Submit and decline only count. R29 and the `ceremony.ts` header say exactly this.
- **intent-finish (finding 9).** The token is `HMAC-SHA256(masterKey, "esign-invite/1." + envelopeId)`: every run writes
  the same signer hash and the same invitation. The master key is a secret (encrypted at rest), so the token cannot be
  derived from storage alone. A run with no master key now leaves the draft (it had one when the intent was verified).
- **Resend (finding 14).** The missing `envelope.sent` is written create-only at seq 1 (right after
  `envelope.created`, or the genesis if that is missing too); any other event in that place means the envelope moved on.
  7 calls (was 8).
- **PDF (finding 16).** The core imports the ceremony's parser (`src/astro/lib/markdown.ts`, pure, no imports) instead of
  duplicating it: a deliberate exception to "core never imports UI", since the published package ships `src/astro` as
  source and `src/domain` not at all. Parsing a 350 KB snapshot put the PDF cron over 50 ms CPU, so the inline parser now
  skips plain runs and bracket pairing scans only brackets (same output, 100% branches kept).
- **audit.page (finding 17).** Kept the paging (the builder requires a page action) as `audit.page:<id>`, which redraws
  the detail page; there is never a next cursor (200 events read).
- **Site URL (finding 18).** Without a site URL no invitation or completion email is queued (null, 0 calls): send
  answers `invitation: "SITE_URL_MISSING"` and the admin shows a warning; resend refuses; the completion job does not
  rotate the copy token. Banner on the envelope list and the affected detail page. The playground now sets
  `EMDASH_SITE_URL` (the e2e journeys read tokens from the emails).
- **Secrets (T062 review).** Session and decline read the master key (`settings.get`) only for an integration envelope;
  session's consent read is `settings.list("consent")`; submit uses that prefix read, or `settings.list()` for an
  integration envelope (one call either way). Decline is 7 (8 with the key). `envelopes/send` (admin, 9 calls) still
  reads `settings.list()`: splitting it would make 10.
- Budgets: session 5 / first view 8 / wrong token 4 / completed 4-5; submit 9; decline 7-8 (race worst case unchanged at
  10 for an integration envelope); resend 7; intent-finish 8.
- Automated code review of the diff is left to the orchestrator's review step.
