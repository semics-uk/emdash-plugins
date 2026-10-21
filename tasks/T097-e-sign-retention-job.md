---
id: T097
title: "E-sign: retention job"
phase: 6
package: esign
edition: free
status: backlog
model: opus-5.5
size: S
depends_on: [T067]
spec: [ES-FR-22, ES-NFR-06]
---

# T097 · E-sign: retention job

## Definition

Purge personal data after the configured period while keeping commitments; signed records kept for their own period.

## Model

**Opus 5.5**: Interacts with legal evidence.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Chain verifies after purge
- [ ] Signed PDFs kept until their period ends
- [ ] Purge resumable in batches

## Implementation (green, then refactor)

- `src/cron/retention.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Purge clears `personal` on audit events (`purgePersonal`, T023) and deletes the envelope `piiSalt` (R28); the chain still verifies
- [ ] Retention keeps `artifacts` (the signed PDF is the signed record, T025)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
