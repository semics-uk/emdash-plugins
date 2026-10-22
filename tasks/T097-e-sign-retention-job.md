---
id: T097
title: "E-sign: retention job"
phase: 6
package: esign
edition: free
status: done
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

- [x] Chain verifies after purge
- [x] Signed PDFs kept until their period ends
- [x] Purge resumable in batches

## Implementation (green, then refactor)

- `src/cron/retention.ts`

## Acceptance criteria

- [x] Within budget
- [x] Purge clears `personal` on audit events (`purgePersonal`, T023) and deletes the envelope `piiSalt` (R28); the chain still verifies
- [x] Retention keeps `artifacts` (the signed PDF is the signed record, T025)
- [x] Purge old outbox rows (sent and failed) as part of retention (T027/T113)
- [x] Personal data purged covers every copy (T034 review): on `signers` the name, email, `ip`, `ua`, `signature` (typed name and strokes), `fieldValues`, `declineReason`, `tokenHash` and `copyTokenHash`; on `envelopes` the `signer` block, `fieldValues` (intent prefill) and `returnUrl`; consumed `nonces`. The signed record (`snapshots`, `artifacts`, the chain) keeps what it printed (the snapshot may contain `{{signer.name}}`/`{{signer.email}}`, the certificate prints the signer's name and IP) until the signed-records period; document that in the operator guide
- [x] `src/domain/audit.ts` header comment says a value disclosed later can still be proven against its commitment; after the purge deletes `piiSalt` it cannot (R28). Correct it with the purge
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- **Decision R45** (BUILD-PLAN §12): two stages from the envelope's close time. Personal-data period
  (`retentionPersonalDataMonths`, default 12, capped at the signed-records period) purges personal data everywhere and
  deletes `piiSalt`; the signed record (`artifacts`, `snapshots`, chain) stays, so "retention keeps artifacts" holds for the
  signed-records period (`retentionSignedRecordsYears`, default 7). `/verify` keeps matching with `chainVerified: true`
  after the first stage; after the second the PDF, snapshot, chain and signer are deleted, the envelope becomes a tombstone
  (`pdfSha256: null`, `recordsPurgedAt`) and `/verify` answers `{ matched: false }`. The verify page's no-match text now
  says old records are deleted after their retention period.
- `src/cron/retention.ts`: daily `retention` (`23 3 * * *`) + one-shot `retention-more`; state in KV `cron:retention`;
  phases `personal`, `records`, `outbox`; pages of 10 envelopes by `createdAt` without `orderBy` (the storage cursor of an
  ordered query looks the last row up by id, so it would break when a draft on the page is deleted). Each page takes two
  ticks (audit events, then signers + envelopes); every tick is at most 8 calls (asserted on every tick of every test). A
  per-phase floor keeps later passes from rescanning purged envelopes. `SCHEDULES_FLAG` is v5.
- Drafts untouched for the personal-data period are deleted with their audit events (nothing was signed). Signer
  `tokenHash` is a unique index, so it becomes `purged:<signerId>` (never a SHA-256 hex) rather than empty.
- Guards: the PDF job skips a purged envelope (it would render blank names); `public/download` refuses a tombstone (no
  re-arm); the admin detail page says what was deleted and hides the PDF link on a tombstone.
- Admin: "Delete personal data" on `/envelopes` (signer email or envelope id), preview then a danger button with a
  confirm (`retention.preview` 2 calls, `retention.erase` 8). It purges personal data at once whatever the period, never an
  open envelope or a completed one whose PDF is not made yet, and deletes that envelope's `invite-*`/`complete-*` outbox
  rows. Up to 10 envelopes per email per click; drafts are only found by id (envelopes have no email index).
- Consumed `nonces` need nothing new: `nonce-sweep` (T061) deletes them hourly after `exp + 60 s`.
- Operator documentation is in `packages/esign/README.md` ("Retention (operators)") until the T103 operator guides exist;
  T103 should carry it over, including that the snapshot and certificate keep the signer's name/IP until the signed-records period.
- Limits: in Free an envelope that is never signed stays `sent` (no automatic expiry) and is never purged; it also pins the
  phase floor, so later passes rescan from it (cheap reads). The tests age envelopes by rewriting their dates; the
  signed-records test shortens the period instead of moving dates back, since the floor assumes dates only move forward.
- Bundle: E-sign Free `backend.js` 101.9 KiB before → 103.7 KiB after (limit 104). Trimmed to fit: Helvetica widths packed
  as base-36 text and the WinAnsi map as a code list in shared `pdf/fonts.ts` (byte-identical tables, checked against the old
  file for all 768 code/face pairs and by a new test), and a shared `toIso()` replacing 22 `new Date(x).toISOString()` in
  the E-sign core. Only ~0.3 KiB is left: the next E-sign Free feature needs more savings first.
- Pro (outside this repo): its self-schedule tests may hard-code `cron:scheduled:v4` and the Free task list; they need the
  v5 flag and the `retention` task.
