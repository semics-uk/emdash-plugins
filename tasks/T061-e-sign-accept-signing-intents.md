---
id: T061
title: "E-sign: accept signing intents"
phase: 3
package: esign
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T060]
spec: [ES-FR-13, SX-NFR-02, SX-NFR-03]
---

# T061 · E-sign: accept signing intents

## Definition

`public/envelopes/from-intent`: verify HMAC, expiry, single-use nonce, return-URL allowlist and template; idempotent per `(cid, ref)`.

## Model

**Opus 5.5**: Protocol security path.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] All intent vectors behave as specified
- [ ] Replayed nonce rejected
- [ ] Off-allowlist return URL rejected
- [ ] Same `(cid, ref)` returns the same envelope
- [ ] Within budget

## Implementation (green, then refactor)

- `src/routes/from-intent.ts`

## Acceptance criteria

- [ ] Nonces expire via sweep
- [ ] T022 already verifies intents in `public/envelopes/from-intent`; add the 102-vector route tests, the nonce sweep (`nonces/<cid>.<nonce>`, ISO `expiresAt`) and the "available to integrations" template flag (any active template is accepted today)
- [ ] E-sign e2e harness reads signing links from `/e2e/mail` (T056 mail capture) instead of clear-text outbox rows, which the now-scheduled drain (T116) can scrub first
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
