---
id: T100
title: "Security review of both products"
phase: 7
package: repo
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T078, T087, T097]
spec: [Phase 7, Management plan: Security]
---

# T100 · Security review of both products

## Definition

Full review: public routes, token entropy, rate limits, CSRF assumptions, XSS, licence code, dependency audit; fixes land with tests.

## Model

**Opus 5.5**: Security judgement.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Every finding has a regression test
- [ ] `pnpm audit` clean or justified

## Implementation (green, then refactor)

- `tasks/reviews/security-1.0.md`

## Acceptance criteria

- [ ] No open Severity 1 or 2
- [ ] Sandboxed routes that throw reach public callers as `400 ROUTE_ERROR` carrying the raw `Error.message` (EmDash dispatch); today the messages are fixed strings (`audit chain contention`, `download link key unavailable`), so check none can carry stored data or a token, or catch and map them to `INTERNAL` (T034 review, Severity 3)
- [ ] `public/envelopes/from-intent` has no rate limit: malformed tokens are rejected before any bridge call, an unknown `cid` costs 2 calls (settings + client). Decide whether a per-IP failure counter is worth a call (T034 review, Severity 4)
- [ ] Events reserve salts `ipHash` with a secret even when no Turnstile secret is set (today the plugin id), without taking reserve past 10 bridge calls (T057 review F6)
- [ ] `checkout/continue` verifies an unknown ref against a decoy hash like `public/booking` and `/redeem` (T057 review F10)
- [ ] Confirm or revisit "no per-IP limit on wrong tokens and codes" for booking, cancel, redeem and continue, and the idempotency-key resubmit that re-issues a token (T057 review F11, F16)
- [ ] Outbox `lastError` cannot keep a booking link or token from provider error text (scrub or keep only a code) (T057 review F12)
- [ ] CSV formula defence also covers full-width `＝ ＋ － ＠` (T057 review F13)
- [ ] Confirm the T117 exception: the E-sign core imports the pure, import-free `src/astro/lib/markdown.ts` for the signed PDF; it must stay dependency-free (add a test that it imports nothing)
- [ ] E-sign Pro `public/self-serve/start` runs at exactly 10 bridge calls (T093): get it to ≤ 9 so an error-path log can never be the 11th; clean up `ss:cap:<template>:<day>` KV counters
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```
