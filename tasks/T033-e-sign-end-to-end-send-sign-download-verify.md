---
id: T033
title: "E-sign: end-to-end send, sign, download, verify"
phase: 1
package: esign
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T025, T026, T027, T028, T030, T031, T032, T009]
spec: [Phase 1 exit criteria]
---

# T033 · E-sign: end-to-end send, sign, download, verify

## Definition

Playwright journey on the playground: admin creates a template and sends, signer signs with a drawn signature, downloads the PDF, verifies it.

## Model

**Sonnet 5.5**: Composes finished parts.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Full journey passes
- [x] Downloaded PDF hash equals the receipt's `pdfSha256`
- [x] Audit chain verifies after the run

## Implementation (green, then refactor)

- `apps/playground/e2e/esign.spec.ts`

## Acceptance criteria

- [x] Runs in CI on Node
- [x] Playground fixture that creates and sends an envelope, so the e2e walks `/sign/[token]` → session → submit → signed PDF → `/verify` (T029 covers only the unknown-link and unmatched-hash states)
- [x] `public/session` exposes signer-fillable fields so the ceremony renders and posts them (T030 handles them only if present)
- [x] Replace the T032 `esign-fixture.mjs` (direct storage writes, no audit chain) with the real send → sign journey, so `/verify` reports `chainVerified: true`
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```

## Notes

- Admin auth: a production build has no sign-in bypass, so `esign-admin.mjs` inserts an admin user and an
  `ec_pat_` token (scope `admin`) after seeding; the journey calls the private routes with it. It replaces
  `esign-fixture.mjs` (deleted). `serve.mjs` changed by two lines (import and call).
- Signing token: read from the clear-text `invite-<envelopeId>:s1` outbox row straight after `envelopes/send`
  (the drain only runs each minute; a scrubbed row retries with a new envelope). Not driving the cron keeps the
  test on the product path.
- Signed PDF: the one-shot `signed-pdf-<id>` task runs within about a second (the node scheduler re-arms on
  `schedule()`), so the test polls `envelopes/get` for `pdfSha256` + `download` instead of waiting a minute.
- Download goes through `/signed/<token>` using the token in the completion email (`complete-<id>` row).
  **Follow-up (real race):** the completion job rotates the signer's token, and the sign page's post-submit poll
  (3 s interval, `client/ceremony.js`) still uses the old one, so it can get `SIGNING_TOKEN_INVALID` and never show
  the link if the rotation lands first. The e2e therefore does not rely on that poll. The poll should hand off
  (for example show "check your email") on `SIGNING_TOKEN_INVALID`, or submit should return a download token.
- Signer-fillable fields: `signerFields` on `envelopes/create`, `fields` in `public/session`, enforced in
  `public/submit` (see packages/esign/CONTEXT.md). The admin page does not expose them yet.
- `t032-verify-page.spec.ts` now signs its own envelope in `beforeAll` and also asserts `chainVerified`.
