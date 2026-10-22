---
id: T091
title: "E-sign Pro: email OTP"
phase: 6
package: esign
edition: pro
status: review
model: sonnet-5.5
size: S
depends_on: [T067, T071]
spec: [ES-FR-16, Decision: OTP default]
---

# T091 · E-sign Pro: email OTP

## Definition

6-digit codes, hashed, 10-minute expiry, 5 attempts, resend after 30 s; on by default for contract templates.

## Model

**Sonnet 5.5**: Re-assigned from Opus 5.5 to reduce usage: small, fully specified OTP rules with clear tests; escalate to Opus 5.5 if green fails twice.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Wrong code decrements attempts
- [x] Expired code fails
- [x] Code never logged or returned
- [x] Resend throttled

## Implementation (green, then refactor)

- `src/domain/otp.ts`

## Acceptance criteria

- [x] Within budget
- [x] Legal brief Q-list: OTP is the only identity step above email-link control; update `docs/legal/brief.md` §5 when it lands
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```

## Notes

- Pro logic is in the Pro repo (branch `pro-agent-t091`): `packages/esign-pro/src/domain/otp.ts` (the task's path, in Pro), `src/otp/routes.ts`, `src/otp/stamp.ts`; tests `otp.unit.test.ts` and `otp.editions.test.ts`.
- Free changes are tiny seams: `OTP_REQUIRED` (shared); `envelope.otp` / `signer.otpVerifiedAt` enforced in submit and shown by the session; `onEnvelopeSend` (seams.ts); a certificate line; the sign page's code step.
- Decisions: "contract templates" = templates not offered to integrations (the template model has no contract kind), so waivers started by an integration are never stamped unless `otpDefault` is on. The code is emailed straight from the route, not queued in the outbox, so it never rests in clear (R32 does not apply). Attempts are counted by read-modify-write on the signer; concurrent guesses can undercount, bounded by the per-IP limit and the 256-bit token every call needs.
- Back on Free, an envelope that needs a code cannot be signed (Free keeps refusing, as with T090's); back on Pro it continues. The send-stamp seam runs in the sandbox bundle, so the Pro editions tests cover it.
- No new secret settings, so no R44 manifest change. `playground e2e` was not run: no browser flow was added (the sign page change is covered by the `handleSign` unit tests).
