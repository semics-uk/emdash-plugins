---
id: T011
title: "Shared: opaque tokens and hashing"
phase: 1
package: shared
edition: free
status: review
model: opus-5.5
size: S
depends_on: [T003]
spec: [EV-FR-07, ES-NFR-02]
---

# T011 · Shared: opaque tokens and hashing

## Definition

Generate 256-bit URL-safe tokens, store only SHA-256 hashes, compare in constant time, and issue short-lived signed links for downloads and calendar files.

## Model

**Opus 5.5**: Security primitives; small surface but must be exactly right.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Token is 43 base64url characters from 32 random bytes
- [x] Hash is stable and hex-encoded
- [x] Constant-time compare returns false for equal-length different inputs and for different lengths
- [x] Signed link verifies before expiry, fails after, fails when any parameter is changed

## Implementation (green, then refactor)

- `packages/shared/src/tokens.ts` on WebCrypto only

## Acceptance criteria

- [x] No token is ever logged (lint rule or test on log calls)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```

## Notes

- API (`packages/shared/src/tokens.ts`, re-exported from the package root): `generateToken(random?)`,
  `hashToken`, `verifyToken(token, storedHash)`, `constantTimeEqual`, `signLink`, `verifyLink`, plus
  `TOKEN_BYTES`, `LINK_SECRET_BYTES`, `DEFAULT_LINK_TTL_MS` (15 min), `MIN_LINK_TTL_MS` (1 s),
  `MAX_LINK_TTL_MS` (1 h), types `RandomBytes`, `SignLinkInput`, `VerifyLinkInput`, `LinkError`.
- Signed links are query params `<params>&exp=<epoch s>&sig=<base64url HMAC-SHA256>`. The MAC covers
  `semics-link/1\n<purpose>\n<exp>\n<sorted, percent-encoded k=v pairs>`, so a link for one purpose
  (e.g. `events/booking-ics`) never verifies for another, and name/value boundaries can't be shifted.
  The signature is checked before expiry (an edited `exp` is `TOKEN_INVALID`); duplicate names, extra
  or missing params and a malformed `exp` are `TOKEN_INVALID`; past expiry is `TOKEN_EXPIRED`. Both
  are existing `ERROR_CODES`, so `toRouteError` maps them. Link secrets must be at least 32 bytes
  (throws otherwise, so it fails closed). `exp` is rounded down, so a link never outlives its ttl.
- Independent of `hmac.ts` (esign-intent tokens, a separate task); the `semics-link/1` prefix is
  distinct from every `esign-*` prefix.
- "Never logged" is enforced by a source scan of `tokens.ts` for console/logger calls, a test that
  spies on every console method while all functions run, and a test that error messages carry no
  token material. No Biome rule was added (that would mean editing the shared `biome.json`).
- Coverage of `src/` is 100% statements, branches, functions and lines. The 100%-branch rule for
  security modules is not yet enforced as a per-file threshold: that needs a `vitest.config.ts` or
  `vitest.coverage.mjs` change, left alone because T018 is editing this package in parallel.
- `CONTEXT.md` "Modules so far" was not updated for the same reason; add `tokens.ts` there on merge.
