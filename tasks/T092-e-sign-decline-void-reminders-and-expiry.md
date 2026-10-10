---
id: T092
title: "E-sign: decline, void, reminders and expiry"
phase: 6
package: esign
edition: free
status: backlog
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

- [ ] Decline records a reason and ends the envelope
- [ ] Void is audited
- [ ] Reminder cadence respected; expiry closes envelopes

## Implementation (green, then refactor)

- `src/domain/lifecycle.ts`, `src/cron/reminders.ts`

## Acceptance criteria

- [ ] Pro parts gated
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
