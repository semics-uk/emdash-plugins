---
id: T095
title: "E-sign Pro: bulk send"
phase: 6
package: esign
edition: pro
status: review
model: sonnet-5.5
size: S
depends_on: [T090, T071]
spec: [ES-FR-20]
---

# T095 · E-sign Pro: bulk send

## Definition

Send one template to a CSV of recipients in cron batches.

## Model

**Sonnet 5.5**: Batch job.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] CSV validation reports bad rows
- [x] Batches stay within budget
- [x] Each recipient gets their own envelope

## Implementation (green, then refactor)

- `src/domain/bulk.ts`

## Acceptance criteria

- [x] Progress shown in admin
- [x] From T090: the admin `/envelopes` page can send to several signers (parallel/sequential) via `pro/envelopes/send`; per-signer resend; template placeholders for every signer (not only `{{signer.*}}` for signer 1)
- [x] Pro admin page to mark templates self-serve and set the daily cap (T093 exposes only the private `pro/templates/self-serve` route)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

Pro code only (Pro repo, branch `pro-agent-t095`; no Free change, Free stays 104.8 KiB, Pro E-sign 152.9 KiB of 256).

- `src/domain/bulk.ts` (pure: CSV parser, row-by-row validation, `neutralise`, pages and ids), `src/bulk` (`pro/bulk/start`
  behind `licence.gate`, 5 calls; one-shot `bulk-<jobId>-<page>`, 8 calls per tick, 10 envelopes per tick), `src/admin/*` (the Pro
  share of Free's `admin` route via `overrideRoutes.admin`, as Events Pro does), `src/routing/resend.ts`.
- Row cap 500 recipients, 200,000 characters. All-or-nothing validation: any bad row refuses the file and nothing is stored.
- Recipients live in `bulk` page documents only while pending; each processed row is overwritten with its outcome, so no name or
  address stays. Invitations use the outbox row `invite-<signerId>`.
- The admin follow-ups: "Send to several signers" form on `/envelopes`, per-signer Resend on an envelope with several signers,
  `{{signer1.name}}` / `{{signer2.email}}` ... placeholders, and a "Self-serve forms" page (On/Off and daily cap).
- A tick that dies mid-page is re-run safely (derived envelope ids); the job page has a Resume button. A re-run after the outbox
  drained could mail a recipient twice (the later link is the valid one); accepted as very unlikely.
