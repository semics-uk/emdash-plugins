---
id: T053
title: "Events UI: integration, call helper and booking page route"
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T004, T006]
spec: [EU-FR-01, EU-FR-05, EU-FR-06]
---

# T053 · Events UI: integration, call helper and booking page route

## Definition

Finish the `./integration` entry: inject the checkout endpoint (`/_events/checkout`) for no-JS posts and the `/booking` page with `Referrer-Policy: no-referrer`.

## Model

**Sonnet 5.5**: Follows the established pattern.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Plain form post to the endpoint redirects to the booking page
- [ ] Header assertion on `/booking`
- [ ] Token never appears in a plugin route URL (request log)

## Implementation (green, then refactor)

- `src/integration/index.ts`

## Acceptance criteria

- [ ] Uses the T004 helper only
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```
