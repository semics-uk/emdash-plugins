---
id: T027
title: "E-sign: invitation and completion emails"
phase: 1
package: esign
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T024, T015]
spec: [ES-FR-10]
---

# T027 · E-sign: invitation and completion emails

## Definition

Queue invitation and completion emails with links only, through the outbox.

## Model

**Sonnet 5.5**: Templates and wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Send queues one invitation per signer
- [x] Completion queues the download email
- [x] No transport: admin banner state is reported

## Implementation (green, then refactor)

- `src/emails/*.ts` templates (text + simple HTML)

## Acceptance criteria

- [x] Templates snapshot-tested
- [x] Emails go through the shared outbox (T015): declare `OUTBOX_COLLECTION` (add an `outbox` collection to the manifest), adapt storage to `OutboxStorage`, `drainOutbox` from the cron tick; delivery is at-least-once
- [x] `envelopes/send` (T022) emails the signing token; handle `delivery: "email"` intents (private send never returns the token)
- [x] Do not send inline from `public/envelopes/from-intent` (it is at 9 calls after T023): queue through the shared outbox and drain in cron
- [x] Completion email links the signed PDF via `downloadLink(ctx, id, now)` (T025) prefixed with the site URL
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- Files: `src/emails/templates.ts` (invitation/completion text + HTML), `src/emails/outbox.ts` (storage adapter, queueing, drain job, `plugin:activate` schedule, `outbox/status`), `outbox` collection in manifest + schema.
- Cron: `plugin:activate` schedules the recurring `outbox-drain` task (`* * * * *`); the `cron` hook tries it first and falls through to `signed-pdf-<id>`.
- Signing token: only hashes are stored, so the invitation (with the clear-text token) sits in the outbox row until sent, and the row keeps it after `sent`. Unavoidable without a custom encrypted drain; a sent-row purge/scrub is a follow-up. The token is valid until the envelope expires or is signed.
- Deviation: templates use a small `fill` instead of shared `renderTemplate`, which Markdown-escapes values (breaks `-`/`_` in tokens and names).
- Budgets: `envelopes/send` 9 (was 8; settings.list replaces settings.get, +1 outbox put); from-intent 9 inline, 10 for `delivery: "email"`; PDF job 7 (+1 call to schedule the completion task); the one-shot `completion-email-<id>` task (`src/cron/completion-email.ts`) is at most 6 (envelope, sender setting, link key, outbox put); drain 8 with 6 messages, 1 when empty.
- The completion link is the 15-minute download link from `downloadLink`, made when that task runs (one tick after the PDF, the drain a tick later): it can lapse before a slow recipient opens it. A stable "get my copy" entry (via `public/session`) would fix this: follow-up.
- If queueing fails after the signer is stored, send returns an error and the envelope is `sent` with no invitation; a resend route is a follow-up (Pro reminders).
- The test host always has a transport, so `no_transport` is covered by a unit test with a stubbed ctx.
