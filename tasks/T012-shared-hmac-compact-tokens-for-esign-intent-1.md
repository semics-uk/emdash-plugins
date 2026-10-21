---
id: T012
title: "Shared: HMAC compact tokens for esign-intent/1"
phase: 1
package: shared
edition: free
status: done
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

- [x] Every vector produces its expected outcome
- [x] A receipt token never verifies as an intent (prefix confusion)
- [x] Expired tokens fail with `TOKEN_EXPIRED`; tampered payloads with `TOKEN_INVALID`
- [x] Pairing string parse rejects malformed and short secrets

## Implementation (green, then refactor)

- `packages/shared/src/hmac.ts`, `packages/shared/src/pairing.ts`

## Acceptance criteria

- [x] 100% branch coverage on the verify path
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```

## Notes

- API (`packages/shared/src/hmac.ts`): `verifyIntentToken`, `verifyReceiptToken`, `verifyLookupToken` and
  `verifyCatalogToken` return `Result<payload, EsignTokenError>`. The failure field is `error`, as in
  `result.ts`; the spec calls it `code`. Inputs: `token: unknown` (anything that isn't a string is
  `TOKEN_MALFORMED`), `now` in epoch **ms** (house style, truncated to seconds) and `getClient(cid)`, which
  can be sync or async. Intents also take `consumeNonce(cid, nonce, expiresAt = exp + 60)` and `siteOrigin`.
  `consumeNonce` is a put-if-absent that returns `false` for a replay or a lost race, and is called only
  after steps 1-8 pass. `siteOrigin` is the fallback for clients that have no allowlist.
- An empty `returnUrlAllowlist` is treated the same as an absent one: it falls back to the same-origin
  default (§7, "no explicit allowlist"). If `siteOrigin` isn't given, such a client allows nothing (fails
  closed). Allowlist entries that break the §7 entry rules are ignored: a query, a fragment, userinfo, or
  plain http on a host other than loopback.
- `signEsignToken(type, payload, secret)` checks the §5 schema (lifetime included) and the size limit,
  and throws rather than emit a token the other side must reject. It reproduces every signable vector
  byte for byte. Time caps such as `exp ≤ holdExpiresAt` remain the caller's job (Events, R5).
- Also exported for reuse: `validateEsignPayload`, `isReturnUrlAllowed` and `encodeBase64Url`/`decodeBase64Url`
  (canonical decoding, §2.1).
- `pairing.ts`:
  - `parsePairing` returns the raw 32-byte secret; `formatPairing` builds the string.
  - `deriveClientSecret(masterKey, clientId)` computes `HMAC-SHA256(masterKey, "esign-client/1." + clientId)`
    (S8). The master key is raw bytes, at least 32. T060 decides how the `integrationMasterKey` setting
    string becomes bytes.
  - `generateClientId` returns `cl_` plus 16 lowercase base32 characters.
- A client secret given to the verifier must be exactly 32 bytes. Any other length throws, because it is a
  configuration bug, not a token error.
- The constant-time comparison reuses `constantTimeEqual` from `tokens.ts` on the canonical base64url
  signature.
- `packages/shared/CONTEXT.md` still lists hmac and pairing as planned. I left it for the orchestrator so it
  doesn't clash with T016, which is working in the same package.
