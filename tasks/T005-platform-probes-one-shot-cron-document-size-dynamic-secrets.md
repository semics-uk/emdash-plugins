---
id: T005
title: "Platform probes: one-shot cron, document size, dynamic secrets, delete veto, slug collisions"
phase: 0
package: events
edition: free
status: review
model: sonnet-5.5
size: M
depends_on: [T000]
spec: [Spikes S3, S4, S7, S8, S9]
---

# T005 · Platform probes: one-shot cron, document size, dynamic secrets, delete veto, slug collisions

## Definition

Answer five platform questions with executable probes in the plugin test hosts and record each result and decision in BUILD-PLAN §7.

## Model

**Sonnet 5.5**: Each probe is a small test with a binary answer.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] S3: schedule a one-shot task through `ctx.cron.schedule` and assert it fires once in the runtime host
- [x] S4: write storage documents of 64 KiB, 512 KiB, 1 MiB, 2 MiB and record the failure point
- [x] S8: `ctx.settings.set` on a key outside `settingsSchema` — assert whether `inspect.settings.raw()` shows ciphertext
- [x] S9: a `content:beforeDelete` handler returning `false` / `{ cancel: true }` — assert whether the delete is blocked
- [x] S7: two fixture plugins with the same slug from different publishers — record the host's behaviour

## Implementation (green, then refactor)

- Probe tests live in `packages/*/tests/probes/` and are deleted after findings are recorded
- Update the fallback columns in BUILD-PLAN §7 where a probe fails

## Acceptance criteria

- [x] Every spike has a recorded answer and decision
- [x] No probe code remains in `src/`
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- Findings are in BUILD-PLAN section 7 "Resolved locally"; evidence and the commit that ran the probes (2b5249d) are in packages/events/tests/probes/README.md. Probe code is deleted.
- S8 is negative (fallback adopted in the spike table). S4 numbers are local D1 only; T110 must re-measure. S7 was source-derived plus a hash probe, not two loaded fixture plugins (the test hosts load one plugin).
- Follow-up: registry installs make ctx.plugin.id an r_ hash, not the slug; do not hard-code semics-events (UI call path, suite wiring, e-sign pairing).
- No src/ or manifest changes, so no changeset.
