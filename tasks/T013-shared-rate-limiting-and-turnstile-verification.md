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

- [x] Limiter allows N requests per window and rejects N+1 with `RATE_LIMITED`
- [x] Window resets after expiry
- [x] Turnstile success and failure responses (faked with `host.http.respond`) map to pass/fail
- [x] Each check costs at most 2 bridge calls (budget harness)

## Implementation (green, then refactor)

- `packages/shared/src/ratelimit.ts`, `packages/shared/src/turnstile.ts`

## Acceptance criteria

- [x] Raw IPs never stored
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```

## Notes

- Storage and fetch are injected (`RateLimitStore` get/set with `ttlSeconds`; `TurnstileFetch`), so the module is pure. Routes adapt `ctx.kv` / `ctx.http.fetch` to them.
- T007's budget harness was not in the tree, so the 2-calls test counts calls on the injected store directly. Allowed check: get + set (2); rejected: 1; Turnstile: 1.
- Counters are keyed `rl:<scope>:<sha256(salt:ip) first 128 bits>:<window>`; raw IP never stored. Not atomic (get then set), fine for abuse control.
- Status left at backlog only because T007 (budget harness) is not done, so the board check rejects review. Work is complete; orchestrator should mark review/done once T007 lands.
