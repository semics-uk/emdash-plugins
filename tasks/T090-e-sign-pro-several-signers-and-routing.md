---
id: T090
title: "E-sign Pro: several signers and routing"
phase: 6
package: esign
edition: pro
status: done
model: opus-5.5
size: M
depends_on: [T067, T071]
spec: [ES-FR-15]
---

# T090 · E-sign Pro: several signers and routing

## Definition

Parallel and sequential signer order with per-signer tokens; envelope completes when all sign.

## Model

**Opus 5.5**: State machine extension.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Sequential: signer 2 can't sign before signer 1
- [x] Parallel: any order completes
- [x] Audit chain covers all signers

## Implementation (green, then refactor)

- `src/domain/routing.ts`

## Acceptance criteria

- [x] UI waiting state (SU-FR-11)
- [x] Automatic reminders (moved here from T092, which kept Free expiry): a Pro cron task `reminders` (add it to `RECURRING_TASKS`, bump `SCHEDULES_FLAG`) that emails each still-pending signer of a `sent`/`in_progress` envelope every `reminderCadenceDays` (setting exists, Pro-only), follows the outbox scrubbing and absolute-link rules (T113/T117: no site URL, nothing queued), writes a `reminder.sent` audit event, stops at `expiresAt`, is licence-gated (T070), and asserts its budget with `withBudget`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```

## Notes

Public side (MIT, `packages/esign` + `packages/shared`), test-first, kept small (Free backend 103.9 -> 104.6 KiB of 112):

- Seam `ceremonyHandlers(step)` (`src/seams.ts`): `public/submit` validates a several-signer signature exactly as for one
  signer and hands `{ envelopeId, envelope, signer, set, now }` to the step. Free has no step: such a submit is
  `ENVELOPE_CLOSED` and writes nothing, so a Pro -> Free downgrade never completes a half-signed envelope (R44 principle;
  tested in both repos).
- Evidence is generic in Free (never paywalled, BUILD-PLAN §13 rule 2): each signer's first view (`viewedAt`, +1 call, 9 for
  the view that also opens the envelope) and decline carry `data.signer`; the signed-PDF job reads every signer and the
  PDF/certificate print each one (one signer keeps the old layout). The sign page shows a waiting state (SU-FR-11).
- Shared: `SIGNING_OUT_OF_TURN`, and `SCHEDULES_FLAG` v7. Reminders are not added to Free's `RECURRING_TASKS` (Free would
  schedule a task it ignores); like Events Pro's `stripe-sweep`, the Pro build schedules `reminders` from Free's one-shot
  `ensure-schedules`, and the flag bump makes existing sites run that task once more.
- `docs/legal/brief.md` §5.5 states what is captured per signer.

Pro side (`emdash-plugins-pro`, `packages/esign-pro`): `src/domain/routing.ts` (pure rules), `src/routing/*`.

- `pro/envelopes/send` (licence-gated "esign/envelope-send", 8 calls) creates and sends in one route; there is no
  several-signer draft, so Free's `envelopes/send` never sees one. Refused without a site URL (T117).
- Submit with several signers defers the audit events, the next sequential invitation and the completion to the one-shot
  `esign-route-<envelopeId>` (submit 5-6 calls, job <= 8), so parallel signers never contend on the chain. The final
  signature answers `status: "in_progress"`; the envelope completes on the next cron tick (about a minute).
- A sequential signer after the first is stored `waiting` with a stand-in `tokenHash` (`waiting:<signerId>`) and gets a
  fresh token when their turn comes; submit also checks the turn (`SIGNING_OUT_OF_TURN`).
- Reminders rotate the signer's token (only the hash is stored), so the earlier link stops working; the email says so.
  At most 5 per signer, which also keeps a chain under the 100 events the routing and PDF jobs read. One signer per tick,
  `reminders-more` continues. Every mail to a signer uses outbox id `invite-<signerId>`, which deletion on request removes.
- Pro E-sign backend 118.7 KiB (ceiling 256, R43).

Not done here (follow-ups): no Block Kit admin form for several signers (the route is usable from the admin API; the
`/envelopes` page still sends one signer) and no per-signer resend (Free's resend re-invites signer 1 only); template
placeholders reach signer 1 only (`{{signer.name}}`); `pnpm --filter playground e2e` not run (no playground port was
assigned to this agent; the Free sign-page change is covered by `tests/ui/sign.test.ts`). Edge: if an envelope expires
between the last signature and the routing job's run, it stays `expired` with every signature audited.
