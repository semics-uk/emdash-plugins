---
id: T023
title: "E-sign: hash-chained audit trail with salted commitments"
phase: 1
package: esign
edition: free
status: in-progress
model: opus-5.5
size: M
depends_on: [T022]
spec: [ES-FR-05, ES-FR-06, ES-NFR-06]
---

# T023 · E-sign: hash-chained audit trail with salted commitments

## Definition

Append audit events where `hash_n = SHA256(hash_n−1 ‖ event)`, hashing salted commitments of personal fields; verify a chain and compute the final envelope hash.

## Model

**Opus 5.5**: Tamper-evidence design with concurrency.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Verifier accepts an untouched chain and rejects any edited, removed or reordered event
- [ ] Deleting personal fields (retention) leaves the chain verifiable
- [ ] Concurrent appends never fork the chain (CAS)

## Implementation (green, then refactor)

- `src/domain/audit.ts`

## Acceptance criteria

- [ ] Verifier is exported for the certificate and tests
- [ ] Collection name is `audit_events` (storage keys must match `^[a-z][a-z0-9_]*$`)
- [ ] Audit events for envelope create and send (T022 writes none)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
