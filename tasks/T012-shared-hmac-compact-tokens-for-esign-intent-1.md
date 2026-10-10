---
id: T012
title: "Shared: HMAC compact tokens for esign-intent/1"
phase: 1
package: shared
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T008, T011]
spec: [BUILD-PLAN §5, SX-NFR-01..03]
---

# T012 · Shared: HMAC compact tokens for esign-intent/1

## Definition

Sign and verify `payload.signature` tokens with per-type prefixes, expiry and nonce handling, passing every vector in `docs/protocol/vectors.json`.

## Model

**Opus 5.5**: Cryptographic protocol implementation.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Every vector produces its expected outcome
- [ ] A receipt token never verifies as an intent (prefix confusion)
- [ ] Expired tokens fail with `TOKEN_EXPIRED`; tampered payloads with `TOKEN_INVALID`
- [ ] Pairing string parse rejects malformed and short secrets

## Implementation (green, then refactor)

- `packages/shared/src/hmac.ts`, `packages/shared/src/pairing.ts`

## Acceptance criteria

- [ ] 100% branch coverage on the verify path
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
