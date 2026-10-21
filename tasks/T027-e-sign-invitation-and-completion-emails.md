---
id: T027
title: "E-sign: invitation and completion emails"
phase: 1
package: esign
edition: free
status: in-progress
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

- [ ] Send queues one invitation per signer
- [ ] Completion queues the download email
- [ ] No transport: admin banner state is reported

## Implementation (green, then refactor)

- `src/emails/*.ts` templates (text + simple HTML)

## Acceptance criteria

- [ ] Templates snapshot-tested
- [ ] Emails go through the shared outbox (T015): declare `OUTBOX_COLLECTION` (add an `outbox` collection to the manifest), adapt storage to `OutboxStorage`, `drainOutbox` from the cron tick; delivery is at-least-once
- [ ] `envelopes/send` (T022) emails the signing token; handle `delivery: "email"` intents (private send never returns the token)
- [ ] Do not send inline from `public/envelopes/from-intent` (it is at 9 calls after T023): queue through the shared outbox and drain in cron
- [ ] Completion email links the signed PDF via `downloadLink(ctx, id, now)` (T025) prefixed with the site URL
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
