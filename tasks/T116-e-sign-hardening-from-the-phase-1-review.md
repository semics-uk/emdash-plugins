---
id: T116
title: "E-sign: hardening from the Phase 1 review"
phase: 6
package: esign
edition: free
status: backlog
model: opus-5.5
size: S
depends_on: [T034]
spec: [ES-FR-04, ES-FR-05, ES-NFR-02, R29]
---

# T116 · E-sign: hardening from the Phase 1 review

## Definition

The Severity 3 and 4 findings of the Phase 1 gate review (`tasks/reviews/phase-1.md`) that no other task
owns. None is exploitable today; each weakens evidence quality, defence in depth or consistency.

## Model

**Opus 5.5**: Audit evidence and token handling, each inside the 10-call budget.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] A GET of `/sign/[token]` (a mail scanner's prefetch) records no `signer.viewed` event; the first view is recorded by a POST (the "Review and sign" step, or the first form post), so the `sent → in_progress` transition (R31) never happens on a GET
- [ ] `signer.consented` records the SHA-256 of the consent wording that was shown (not only `consentVersion`, which identifies the text only if the admin remembers to bump it), within the submit budget (9)
- [ ] Admin audit events (`envelope.created|sent|voided`) record the acting user's id from `routeCtx.user` (not the email), not only `actor: "admin"`
- [ ] `envelopes/resend` appends a missing `envelope.sent` only while the envelope is still `sent` (a decline racing a resend cannot leave `envelope.sent` after `envelope.declined`)
- [ ] Two concurrent `intent-finish-<id>` runs cannot leave the signer's `tokenHash` and the queued invitation's token out of step (write the signer and the invitation from one token chosen deterministically per envelope, or make the guarded `draft → sent` update the first write)
- [ ] `public/submit` rejects stroke points outside 0–1 (the pad normalises to 0–1; the PDF writer clamps, so today they only distort the drawing)

## Implementation (green, then refactor)

- `src/routes/ceremony.ts`, `src/astro/lib/sign.ts`, `src/routes/envelopes.ts`, `src/cron/intent-finish.ts`, `src/domain/signing.ts`

## Acceptance criteria

- [ ] R29's "wrong tokens are rate-limited per IP" is accurate: the ceremony limiter counts failures after the lookup and never gates one, so it does not slow guessing (256-bit tokens make guessing moot). Either gate the lookup where the budget allows (session 7 → 8; submit is at 9, so not there) or reword R29 and the `ceremony.ts` header
- [ ] The signed PDF renders the snapshot's Markdown (emphasis, lists, links as text) the way the ceremony shows it, instead of the raw syntax; the bytes stay deterministic
- [ ] The audit timeline table's `audit.page` action has a handler or the table drops paging (a Free chain is a handful of events; 200 are shown)
- [ ] Invitation and completion emails refuse to queue a relative link when `ctx.site.url` is unset (today the link is `/sign/<token>`), and the admin shows why
- [ ] Budgets unchanged or lower; asserted with `expectWithinBudget`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
