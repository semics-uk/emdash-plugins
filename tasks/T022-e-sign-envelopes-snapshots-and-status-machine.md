---
id: T022
title: "E-sign: envelopes, snapshots and status machine"
phase: 1
package: esign
edition: free
status: review
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

- [x] Illegal transitions are rejected (table-driven test over every pair)
- [x] Snapshot is immutable after send
- [x] `docSha256` matches the canonical snapshot
- [x] Signer token stored as hash only

## Implementation (green, then refactor)

- `src/domain/envelopes.ts`, `src/domain/state.ts`, `src/routes/envelopes.ts`

## Acceptance criteria

- [x] State machine has one source of truth used by routes and cron
- [x] Replaces the T020 stub handler for `public/envelopes/from-intent`; snapshot writes stay ≤ 512 KiB per document (chunk if needed); audit collection is `audit_events`
- [x] Every route and cron job in this task asserts its budget with `withBudget(host)` + `expectWithinBudget` from `@semics-tech/shared/testing` (T007); this is the first adopter in its package, so also wire the harness into the package test setup
- [x] Snapshot = `renderTemplate` output (already escaped, T017); `docSha256 = sha256Hex(canonicalSnapshot(rendered))`, and the ceremony shows exactly that text
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- **Status machine** (`src/domain/state.ts`): `draft → sent | voided`; `sent → in_progress | completed | declined |
  voided | expired`; `in_progress → completed | declined | voided | expired`; the rest are terminal.
  `transitionEnvelope(store, id, from, to, set)` checks the table, then writes one `updateIf` guarded on
  `status = from` (`CONFLICT` on a lost race). T024 (submit) and T092 (void/decline/expire cron) must use it.
- **Snapshot**: `docSha256 = sha256Hex(canonicalSnapshot(renderTemplate(body, values)))`; the stored text *is* the
  canonical text, so the ceremony shows exactly what was hashed. Chunks of 64 Ki UTF-16 units (≤ 384 KiB JSON worst
  case), ids `<envelopeId>:<docSha256[0..16]>:<i>`, written before the envelope's `draft → sent` write. Sending is the
  only writer, so a sent envelope is never re-rendered; template edits after send change nothing (tested).
- Built-in template values: `signer.name`, `signer.email`, and `participant.name` for guardian intents. Every other
  template field must be supplied (private `fields`, intent `prefill`), else `BAD_REQUEST` + `MISSING_FIELD` issue.
- **Signer token**: only `tokenHash` is stored (`signers/<envelopeId>:s1`). A D1 unique-index rejection of the hash
  (R26) retries with a fresh token, up to 3 tries (faked in `tests/signer-token.test.ts`). Private `envelopes/send`
  does not return the token: **T027 must email it from the send handler** (it is in scope there as `token`).
- **from-intent** (replaces the T020 stub; 8 bridge calls max): verifies with the shared `verifyIntentToken`; client =
  `clients` doc queried by `clientId` (fields used: `revokedAt`, `returnUrlAllowlist`); secret =
  `deriveClientSecret(masterKeyBytes(integrationMasterKey), cid)`; nonce = create-only `nonces/<cid>.<nonce>`
  (`expiresAt` ISO). Template check, then `(cid, ref)` idempotency: an envelope that isn't declined/voided/expired is
  returned; otherwise a new one with deterministic id `env_<sha256(cid\nref)[0..32]>_<attempt>`, created with
  `compareAndSet(null)` so two racing intents can't both create one. Only token hashes are stored, so a repeat intent
  for an inline signer who hasn't signed **rotates** the token (the old one stops working). `delivery: "email"`
  returns no token (email is T027).
- **Decisions for other tasks**: `masterKeyBytes` = UTF-8 bytes of the trimmed setting, ≥ 32 bytes, else every
  client is unknown (`src/domain/master-key.ts`); T060 owns key generation and may tighten this while no client is
  paired. T061 still owns the vector suite, the nonce sweep and the "available to integrations" template flag (no such
  flag exists yet, so any active template is accepted). The audit events for create/send are T023's.
- Route errors keep the T021 pattern (error body returned, HTTP 200); mapping `toRouteError(...).status` onto the
  response is a cross-route follow-up.
- Budget: every route test asserts `{ calls: 8, cpuMs: 50 }` (R22 target). One cold run on a loaded machine
  exceeded the CPU ceiling once and passed on rerun (CPU figure is wall time minus bridge waits).
- **Gate evidence (2026-10-21, machine load 10–17 on 8 cores from parallel agents)**: `pnpm verify` stopped at the
  shared package's T007 CPU-stability test (±20% spread; not touched here). `pnpm --filter @semics-tech/emdash-esign
  verify` passed validate + typecheck; tests 128/131, the 3 failures being CPU-ceiling readings of 57–82 ms,
  including T021's untouched `templates/create`. On a quieter run all 131 pass, and the probe measured send and
  from-intent at ≤ 23 ms CPU and ≤ 6 / ≤ 8 bridge calls. Re-run the gates on an idle machine before merging.
