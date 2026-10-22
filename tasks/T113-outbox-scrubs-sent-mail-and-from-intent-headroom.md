---
id: T113
title: "Outbox scrubs sent mail; from-intent headroom"
phase: 1
package: shared
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T027]
spec: [ES-NFR-02, R22, R32]
---

# T113 · Outbox scrubs sent mail; from-intent headroom

## Definition

T027 queues E-sign invitations with the clear-text signing token in the outbox row (only token hashes are
stored elsewhere), and the row keeps it after sending. Make the shared `drainOutbox` scrub message
content when it marks a row `sent` or `failed` in the same `putMany` it already makes (no extra call):
keep `to`, `subject`, `kind`, timestamps and attempt counts, drop the body (text and HTML) and any
payload. Second, `public/envelopes/from-intent` with `delivery: "email"` now sits exactly at the hard limit
of 10 bridge calls; bring it back to at most 9 (for example by folding the outbox put into an existing
`putMany`, or reading settings once).

## Model

**Sonnet 5.5**: Two contained changes with clear tests.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] After a successful drain, the stored row has no body, HTML or payload, and no string in it contains the signing token
- [x] A row that gives up (`failed`) is scrubbed the same way and keeps `lastError`
- [x] The drain's call count is unchanged (1 query + sends + 1 putMany)
- [x] `from-intent` with `delivery: "email"` stays within 9 bridge calls; inline stays within 9

## Implementation (green, then refactor)

- `packages/shared/src/outbox.ts`, `packages/esign/src/routes/envelopes.ts`, `packages/esign/src/emails/outbox.ts`

## Acceptance criteria

- [x] Events confirmations (T048/T050 queue only ids) are unaffected
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
corepack pnpm@10.23.0 --filter @semics-tech/shared exec vitest run tests/outbox.test.ts
corepack pnpm@10.23.0 --filter @semics-tech/emdash-esign exec vitest run tests/emails.routes.test.ts
```

## Notes

- `drainOutbox` rewrites `sent` and `failed` rows with `scrubMessage` (keeps `to`, `subject`, `kind` if present; drops text, HTML and any extra field such as a payload) inside its existing `putMany`; call count unchanged. A row that will retry keeps its body. Events confirmations queue only ids and are unaffected.
- from-intent: the create-only envelope write now goes first; the existing-envelopes `query` only runs when that write loses. Fresh intent: 8 calls inline, 9 email. Replay: 7 (inline reuse adds a token rotation). The snapshot write now happens after the envelope write, by the winner only.
- Terminal-retry path (declined/voided/expired envelope for the same ref): 10 calls inline (asserted). With email delivery the route (8 calls) stores the next envelope as a `draft` and schedules the one-shot task `intent-finish-<id>` (`cron/intent-finish.ts`, 8 calls, asserted), which writes snapshot, signer, invitation and opening audit events and moves it to `sent` last; a re-run is 1 call. The response status is `draft` in that case. A replay that finds a draft re-arms the task. The nonce write is unchanged.
- Nothing to fold the outbox put into: each storage collection is its own bridge call, so the saving came from dropping the read instead.
