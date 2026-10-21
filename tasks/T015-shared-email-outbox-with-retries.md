---
id: T015
title: "Shared: email outbox with retries"
phase: 1
package: shared
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T003, T007]
spec: [EV-FR-08, ES-FR-10]
---

# T015 · Shared: email outbox with retries

## Definition

Queue emails in a storage collection, deliver from cron in bounded batches with backoff, and expose transport-missing state for the admin banner.

## Model

**Sonnet 5.5**: Queue logic with clear tests.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Queued mail is sent once on the next cron run
- [x] A failing send is retried with backoff and gives up after 5 attempts
- [x] With no `ctx.email`, mail stays queued and `status()` reports `no_transport`
- [x] A cron batch stays within the call budget

## Implementation (green, then refactor)

- `packages/shared/src/outbox.ts` with storage schema helper

## Acceptance criteria

- [x] Used by both cores
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```

## Notes

- Storage is injected as a narrow `OutboxStorage` (`put`, `putMany`, `query({status, nextAttemptAtLte, limit})`); cores adapt `ctx.storage.outbox` to it. `email` is `ctx.email` or undefined.
- A tick = 1 query + up to `maxPerTick` (default 6) sends + 1 putMany = 8 calls. Backoff 60 s doubling (cap 1 h), 5 attempts then `failed`. `outboxStatus` costs 2 calls (counts capped at 100).
- Sends are at-least-once (a crash between send and putMany re-sends).
