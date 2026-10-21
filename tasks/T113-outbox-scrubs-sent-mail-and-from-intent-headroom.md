---
id: T113
title: "Outbox scrubs sent mail; from-intent headroom"
phase: 1
package: shared
edition: free
status: in-progress
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

- [ ] After a successful drain, the stored row has no body, HTML or payload, and no string in it contains the signing token
- [ ] A row that gives up (`failed`) is scrubbed the same way and keeps `lastError`
- [ ] The drain's call count is unchanged (1 query + sends + 1 putMany)
- [ ] `from-intent` with `delivery: "email"` stays within 9 bridge calls; inline stays within 9

## Implementation (green, then refactor)

- `packages/shared/src/outbox.ts`, `packages/esign/src/routes/envelopes.ts`, `packages/esign/src/emails/outbox.ts`

## Acceptance criteria

- [ ] Events confirmations (T048/T050 queue only ids) are unaffected
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
corepack pnpm@10.23.0 --filter @semics-tech/shared exec vitest run tests/outbox.test.ts
corepack pnpm@10.23.0 --filter @semics-tech/emdash-esign exec vitest run tests/emails.routes.test.ts
```
