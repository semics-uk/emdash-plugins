---
id: T090
title: "E-sign Pro: several signers and routing"
phase: 6
package: esign
edition: pro
status: in-progress
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

- [ ] Sequential: signer 2 can't sign before signer 1
- [ ] Parallel: any order completes
- [ ] Audit chain covers all signers

## Implementation (green, then refactor)

- `src/domain/routing.ts`

## Acceptance criteria

- [ ] UI waiting state (SU-FR-11)
- [ ] Automatic reminders (moved here from T092, which kept Free expiry): a Pro cron task `reminders` (add it to `RECURRING_TASKS`, bump `SCHEDULES_FLAG`) that emails each still-pending signer of a `sent`/`in_progress` envelope every `reminderCadenceDays` (setting exists, Pro-only), follows the outbox scrubbing and absolute-link rules (T113/T117: no site URL, nothing queued), writes a `reminder.sent` audit event, stops at `expiresAt`, is licence-gated (T070), and asserts its budget with `withBudget`
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
