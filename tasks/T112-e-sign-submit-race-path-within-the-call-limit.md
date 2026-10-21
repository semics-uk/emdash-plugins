---
id: T112
title: "E-sign: submit race path within the call limit"
phase: 1
package: esign
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T025]
spec: [ES-FR-04, R22]
---

# T112 · E-sign: submit race path within the call limit

## Definition

`public/submit` normally makes 9 bridge calls, but when a first-view `signer.viewed` event lands between its
audit-head read and its writes it rebuilds the events and reaches 13, over the hard limit of 10. On
Cloudflare that throws "Too many subrequests" part-way through a signature. Remove the race instead of
paying for it: `submit` accepts only an envelope already `in_progress` (the ceremony always calls
`public/session` first, which performs the `sent → in_progress` view transition and writes
`signer.viewed`). A submit against a `sent` envelope returns a clear error (new code `SESSION_REQUIRED`
in the shared registry, 409) and writes nothing. With views and submits serialised by status, the
rebuild path is deleted.

## Model

**Sonnet 5.5**: A contained change to one route with a clear rule and tests.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Submit against a `sent` envelope returns `SESSION_REQUIRED` and writes nothing (budget asserted)
- [x] After `public/session`, submit succeeds within 9 calls and the chain verifies to `finalHash`
- [x] Two concurrent submits: one completes, the other gets `CONFLICT`; neither exceeds 10 calls
- [x] No code path in `public/submit` can exceed 10 calls (the rebuild branch is gone)

## Implementation (green, then refactor)

- `packages/esign/src/routes/ceremony.ts`, `packages/esign/src/domain/signing.ts`
- `packages/shared/src/result.ts` (`SESSION_REQUIRED`)

## Acceptance criteria

- [x] T030 note: the ceremony UI calls `public/session` before showing the submit button (it already must)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
corepack pnpm@10.23.0 --filter @semics-tech/emdash-esign exec vitest run tests/ceremony.routes.test.ts
```

## Notes

- Concurrent submits: the loser gets `ENVELOPE_CLOSED` (the existing code for a lost transition; there is no `CONFLICT` code in the registry), or `SIGNING_TOKEN_INVALID` if it reads the signer after the winner finished. The test accepts either.
- Existing ceremony/download tests now call `public/session` before submitting (the real ceremony does).
- T030: the UI must call `public/session` before enabling submit (it already does).
- `writeChain` is kept for `public/decline`.
