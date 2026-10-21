---
id: T022
title: "E-sign: envelopes, snapshots and status machine"
phase: 1
package: esign
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T021, T011]
spec: [ES-FR-02, ES-FR-03]
---

# T022 · E-sign: envelopes, snapshots and status machine

## Definition

Create and send envelopes from a template version with one signer, freeze the snapshot and its `docSha256`, and enforce the status transitions.

## Model

**Opus 5.5**: State machine with integrity guarantees.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Illegal transitions are rejected (table-driven test over every pair)
- [ ] Snapshot is immutable after send
- [ ] `docSha256` matches the canonical snapshot
- [ ] Signer token stored as hash only

## Implementation (green, then refactor)

- `src/domain/envelopes.ts`, `src/domain/state.ts`, `src/routes/envelopes.ts`

## Acceptance criteria

- [ ] State machine has one source of truth used by routes and cron
- [ ] Replaces the T020 stub handler for `public/envelopes/from-intent`; snapshot writes stay ≤ 512 KiB per document (chunk if needed); audit collection is `audit_events`
- [ ] Every route and cron job in this task asserts its budget with `withBudget(host)` + `expectWithinBudget` from `@semics-tech/shared/testing` (T007); this is the first adopter in its package, so also wire the harness into the package test setup
- [ ] Snapshot = `renderTemplate` output (already escaped, T017); `docSha256 = sha256Hex(canonicalSnapshot(rendered))`, and the ceremony shows exactly that text
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
