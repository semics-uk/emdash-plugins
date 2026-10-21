---
id: T011
title: "Shared: opaque tokens and hashing"
phase: 1
package: shared
edition: free
status: in-progress
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

- [ ] Token is 43 base64url characters from 32 random bytes
- [ ] Hash is stable and hex-encoded
- [ ] Constant-time compare returns false for equal-length different inputs and for different lengths
- [ ] Signed link verifies before expiry, fails after, fails when any parameter is changed

## Implementation (green, then refactor)

- `packages/shared/src/tokens.ts` on WebCrypto only

## Acceptance criteria

- [ ] No token is ever logged (lint rule or test on log calls)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
