---
id: T072
title: "Licence issuing Worker"
phase: 4
package: licence-worker
edition: pro
status: in-progress
model: opus-5.5
size: M
depends_on: [T070]
spec: [Management plan: How a sale works]
---

# T072 · Licence issuing Worker

## Definition

A Cloudflare Worker that verifies Paddle webhooks, signs licence keys, issues registry tokens and handles renewals, cancellations and refunds; runs locally with Miniflare and recorded webhook fixtures.

## Model

**Opus 5.5**: Payments-adjacent security.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Valid webhook issues a key that `licence.ts` accepts
- [ ] Bad signature rejected
- [ ] Renewal extends `updatesUntil`
- [ ] Refund revokes the registry token but never disables a site

## Implementation (green, then refactor)

- `apps/licence-worker/`

## Acceptance criteria

- [ ] Signing key only from secrets
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter licence-worker verify
```
