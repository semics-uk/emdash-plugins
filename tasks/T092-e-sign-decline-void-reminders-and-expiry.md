---
id: T092
title: "E-sign: decline, void, reminders and expiry"
phase: 6
package: esign
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T067]
spec: [ES-FR-17]
---

# T092 · E-sign: decline, void, reminders and expiry

## Definition

Decline (free) and void (free); automatic reminders and expiry (Pro) via cron.

## Model

**Sonnet 5.5**: Lifecycle wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Decline records a reason and ends the envelope (existing: `tests/ceremony.routes.test.ts` ES-FR-04, signing.domain)
- [x] Void is audited (existing: `tests/admin.runtime.test.ts` ES-US-4, `hardening.routes.test.ts`)
- [x] Expiry closes envelopes (`tests/expire.test.ts`). Reminder cadence is Pro: moved to T090 as an acceptance criterion

## Implementation (green, then refactor)

- `src/domain/lifecycle.ts`, `src/cron/reminders.ts`

## Acceptance criteria

- [x] Pro parts gated (Free ships no reminder code; `tests/self-schedule.test.ts` lists the exact Free tasks; reminders now on T090)
- [x] Free expiry for unsigned `sent` envelopes (T097: today they never close, so retention never purges them); deletion by signer email also finds drafts (add an index if needed). E-sign Free is at 103.7 of 104 KiB — trim to fit
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- Decline and void already existed (T024, T028, T117) and are tested; this task added what was missing: the Free `expire` task
  (`src/cron/expire.ts`, BUILD-PLAN R46) and email lookup of drafts. Reminders are Pro: Free adds no reminder code, and the
  Pro `reminders` task is now a criterion on T090. BUILD-PLAN section 13 now lists expiry as Free.
- `expire` (hourly, `17 * * * *`) + one-shot `expire-more`: 1 query (`status in [sent, in_progress]`, `expiresAt < now`) and
  3 calls per envelope, 2 envelopes per tick, so at most 8 calls with the continuation. `SCHEDULES_FLAG` is v6.
- Drafts: envelopes carry a lowercase `signerEmail` (new index in `schema.ts` and the manifest) so deletion on request by
  email finds drafts, which have no signer document. The purge clears it. Older envelopes are still found through `signers`.
  Erasure by email stays at its old call count.
- Bundle: 106,390 bytes (103.9 KiB of 104). The feature cost about 0.7 KiB; trimmed without behaviour change: admin notices
  and the repeated back/open buttons in `src/admin/pages.ts` now go through `note/info/warn/error`, `toEnvelopes()`,
  `toTemplates()`, `openEnvelope()`; the month names are one split string; the duplicate `obj` helper in
  `routes/templates.ts` imports the one from `routes/envelopes.ts`. About 100 bytes of room are left.
