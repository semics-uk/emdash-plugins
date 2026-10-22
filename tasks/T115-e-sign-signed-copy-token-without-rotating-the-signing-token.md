---
id: T115
title: "E-sign: signed-copy token without rotating the signing token"
phase: 1
package: esign
edition: free
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T033]
spec: [ES-FR-05, R36]
---

# T115 · E-sign: signed-copy token without rotating the signing token

## Definition

The completion-email job (T032) rotates the signer's signing token so it can email a `/signed/<token>`
link (only token hashes are stored). The sign page's post-submit poll still holds the old token, so if the
rotation lands first the poll gets `SIGNING_TOKEN_INVALID` and the signer never sees the download link.
Give the signed copy its own credential instead (R36): the completion job mints a separate copy token and
stores only its hash on the signer (`copyTokenHash`); `/signed/[token]` and `public/session` accept either
the signing token (completed envelopes only expose the closed state and download link) or the copy token;
the signing token is never rotated at completion.

## Model

**Sonnet 5.5**: A contained change with clear tests.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] After completion and the completion job, the original signing token still returns the closed state with a download link
- [ ] The emailed copy token opens `/signed/<token>` and returns a fresh download link
- [ ] A copy token cannot open a session for a non-completed envelope or submit anything
- [ ] Re-running the completion job does not mint a second copy token once the email is queued
- [ ] Budgets unchanged or lower; asserted with `expectWithinBudget`

## Implementation (green, then refactor)

- `packages/esign/src/cron/completion-email.ts`, `src/routes/ceremony.ts`, `src/domain/envelopes.ts`

## Acceptance criteria

- [ ] The e2e journey (`apps/playground/e2e/esign.spec.ts`) checks the sign page shows the download link after submit
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
corepack pnpm@10.23.0 --filter @semics-tech/emdash-esign exec vitest run tests/ceremony.routes.test.ts tests/emails.routes.test.ts
```
