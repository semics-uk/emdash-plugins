---
id: T033
title: "E-sign: end-to-end send, sign, download, verify"
phase: 1
package: esign
edition: free
status: backlog
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

- [ ] Full journey passes
- [ ] Downloaded PDF hash equals the receipt's `pdfSha256`
- [ ] Audit chain verifies after the run

## Implementation (green, then refactor)

- `apps/playground/e2e/esign.spec.ts`

## Acceptance criteria

- [ ] Runs in CI on Node
- [ ] Playground fixture that creates and sends an envelope, so the e2e walks `/sign/[token]` → session → submit → signed PDF → `/verify` (T029 covers only the unknown-link and unmatched-hash states)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```
