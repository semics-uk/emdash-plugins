---
id: T032
title: "E-sign UI: verify page"
phase: 1
package: esign
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T029, T026]
spec: [SU-FR-10, ES-US-6]
---

# T032 · E-sign UI: verify page

## Definition

`<VerifyDocument>` hashes a dropped file with WebCrypto in the browser and posts only the hash.

## Model

**Sonnet 5.5**: Small UI.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Playwright: dropping the signed PDF shows matched
- [ ] Network log shows no file upload, only the hash

## Implementation (green, then refactor)

- `src/astro/VerifyDocument.astro`, `src/client/verify.ts`

## Acceptance criteria

- [ ] Accessible file input
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
