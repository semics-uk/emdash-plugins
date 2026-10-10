---
id: T013
title: "Shared: rate limiting and Turnstile verification"
phase: 1
package: shared
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T003, T007]
spec: [EV-NFR-04]
---

# T013 · Shared: rate limiting and Turnstile verification

## Definition

KV fixed-window rate limiter keyed by hashed IP, and a Turnstile verifier using `ctx.http`.

## Model

**Sonnet 5.5**: Well-understood patterns.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Limiter allows N requests per window and rejects N+1 with `RATE_LIMITED`
- [ ] Window resets after expiry
- [ ] Turnstile success and failure responses (faked with `host.http.respond`) map to pass/fail
- [ ] Each check costs at most 2 bridge calls (budget harness)

## Implementation (green, then refactor)

- `packages/shared/src/ratelimit.ts`, `packages/shared/src/turnstile.ts`

## Acceptance criteria

- [ ] Raw IPs never stored
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
