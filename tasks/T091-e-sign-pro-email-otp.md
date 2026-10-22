---
id: T091
title: "E-sign Pro: email OTP"
phase: 6
package: esign
edition: pro
status: backlog
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

- [ ] Wrong code decrements attempts
- [ ] Expired code fails
- [ ] Code never logged or returned
- [ ] Resend throttled

## Implementation (green, then refactor)

- `src/domain/otp.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
