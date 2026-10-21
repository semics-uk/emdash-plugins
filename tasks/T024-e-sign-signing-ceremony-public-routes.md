---
id: T024
title: "E-sign: signing ceremony public routes"
phase: 1
package: esign
edition: free
status: done
model: sonnet-5.5
size: M
depends_on: [T023, T013]
spec: [ES-FR-04, ES-US-2]
---

# T024 · E-sign: signing ceremony public routes

## Definition

`public/session` and `public/submit`: consent, intent, typed name or stroke JSON, field validation, binding the signature to `docSha256`, and completing the envelope.

## Model

**Sonnet 5.5**: Re-assigned from Opus 5.5 to reduce usage: well-specified by the protocol spec, the audit chain (T023) and the budget harness; escalate to Opus 5.5 if green fails twice.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Submit without consent or intent fails
- [x] Stroke JSON over 32 KB is rejected
- [x] Wrong or reused token fails
- [x] A completed submit writes audit events and moves status to completed
- [x] Both routes within budget
- [x] Responses contain no other signer's data

## Implementation (green, then refactor)

- `src/routes/ceremony.ts`, `src/domain/signing.ts`

## Acceptance criteria

- [x] Public routes declare methods and body limits
- [x] Status changes only through `transitionEnvelope` (T022, `src/domain/state.ts`)
- [x] Meets the Definition of Done in `tasks/README.md`

## Notes

- Routes: `src/routes/ceremony.ts` (session, submit, decline); pure rules in `src/domain/signing.ts`. OTP routes stay stubbed (Pro).
- Bridge calls: session 7 on first view / 5 later, submit 8, decline 7 (all asserted at the 8-call target). Submit reads the audit head before the transition so `finalHash` is written by the one guarded update; a view racing in between triggers a rewrite and a `finalHash` correction (rare, +4 calls, still under 10).
- Added `extendAuditChain`, `readAuditHead`, `writeAuditEvents` to `domain/audit.ts` (a 3-event batch in 2 write calls).
- The token is read from the POST body; a token in the URL is `TOKEN_IN_QUERY`. Bad tokens are counted per IP with shared `rateLimit` (20 per 10 min), only on the failure path, so the happy path pays nothing.
- Not done: Turnstile on the ceremony (no test requires it; it adds a settings read and a fetch to a tight budget); signed PDF, emails and receipts at completion belong to later tasks. `signature.sha256 = SHA256(JSON([docSha256, kind, typedName|null, strokes|null]))`.
- The `public/submit` body limit stays at the frozen 256 KiB; strokes are capped at 32 KB in the domain.

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
