---
id: T091
title: "E-sign Pro: email OTP"
phase: 6
package: esign
edition: pro
status: backlog
model: opus-5.5
size: S
depends_on: [T067]
spec: [ES-FR-16, Decision: OTP default]
---

# T091 · E-sign Pro: email OTP

## Definition

6-digit codes, hashed, 10-minute expiry, 5 attempts, resend after 30 s; on by default for contract templates.

## Model

**Opus 5.5**: Authentication logic.

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
