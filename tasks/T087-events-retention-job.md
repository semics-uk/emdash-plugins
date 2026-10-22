---
id: T087
title: "Events: retention job"
phase: 5
package: events
edition: free
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T057]
spec: [EV-FR-20]
---

# T087 · Events: retention job

## Definition

Daily job deletes booking personal data 12 months after the event (configurable) and supports deletion on request.

## Model

**Sonnet 5.5**: Contained job.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Data older than the period is purged; newer kept
- [ ] On-request deletion removes personal fields but keeps counts

## Implementation (green, then refactor)

- `src/cron/retention.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Bookings' `ipHash` is cleared once the reserve rate window has passed: without a Turnstile secret it is salted with the public plugin id and reversible over IPv4 (T057 review F6)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
