---
id: T023
title: "E-sign: hash-chained audit trail with salted commitments"
phase: 1
package: esign
edition: free
status: review
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

- [x] Verifier accepts an untouched chain and rejects any edited, removed or reordered event
- [x] Deleting personal fields (retention) leaves the chain verifiable
- [x] Concurrent appends never fork the chain (CAS)

## Implementation (green, then refactor)

- `src/domain/audit.ts`

## Acceptance criteria

- [x] Verifier is exported for the certificate and tests
- [x] Collection name is `audit_events` (storage keys must match `^[a-z][a-z0-9_]*$`)
- [x] Audit events for envelope create and send (T022 writes none)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- **Design.** `hash_n = SHA256(prevHash ‖ canonical(event))`, genesis = 64 zeros. `canonical` is a fixed-order JSON
  array (version, envelopeId, seq, type, at, actor, sorted `data` pairs, sorted `commitments` pairs), so storage key
  order never changes a hash. Personal fields (`name`, `email`, `participant`, `ip`, `ua`) are hashed only as
  `SHA256(piiSalt ‖ value)` commitments; raw values sit in `personal`, outside the hash, and `purgePersonal` nulls it.
  The verifier checks envelope id, seq = position, own hash, link to the previous hash, and (with the salt) that
  any raw value still present opens its commitment. A truncated tail or a wholly rewritten chain is only detectable
  against a recorded head, so `verifyAuditChain` takes `head`; T026 should store `finalHash = finalEnvelopeHash(docSha256, head)`
  and the certificate should print the head.
- **No forks.** Event ids are `<envelopeId>:a<seq, 6 digits>` written with create-only `compareAndSet(id, null)`;
  a loser re-reads the head and retries (default 2 attempts = at most 4 bridge calls). A fresh envelope's opening
  events go in one `putMany` (`initialAuditEvents`) because the writer just created the id (UUID, or won the
  create-only envelope write in from-intent). `send` throws (500) if its append loses every race; in practice only
  the winner of the guarded `draft → sent` update reaches it.
- **Salt location (deviation).** BUILD-PLAN lists `piiSalt` on `signers`; it is on the envelope instead
  (`EnvelopeDoc.piiSalt`, 32 random bytes hex), because the chain starts before any signer exists and every audit
  writer already reads the envelope. Route responses strip it. The retention task (T0xx) decides whether to keep
  it: keeping it lets a later-disclosed value be proven; deleting it makes commitments of low-entropy values
  (IPs) unguessable. `ip`/`ua` are top-level in BUILD-PLAN's `audit_events` row; here they live in `personal`.
- **Budget.** create 3 calls, send 8, from-intent **9** on the fresh path (8 before: + the opening audit `putMany`).
  It is inside the hard limit of 10 but over the target of 8, so the route test asserts 9 for from-intent only
  (`INTENT_TARGET`). Follow-up for T027 (emails): an inline email send from from-intent would hit 10; queue it via
  the outbox/cron instead. The lost-create-race path was already 9 in T022 (envelope read + token rotation) and
  writes no audit events (the winner does).
- Coverage: `src/domain/audit.ts` is in `strictBranches` (100% branches); measured 100% statements/branches/lines.
- Event builders `createdAuditEvent` / `sentAuditEvent` live in `domain/envelopes.ts`; later tasks add their own
  (types `signer.viewed|consented|signed|declined`, `envelope.completed|declined|voided|expired` are already in the union).
