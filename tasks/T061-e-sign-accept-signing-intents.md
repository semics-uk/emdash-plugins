---
id: T061
title: "E-sign: accept signing intents"
phase: 3
package: esign
edition: free
status: review
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

- [x] All intent vectors behave as specified
- [x] Replayed nonce rejected
- [x] Off-allowlist return URL rejected
- [x] Same `(cid, ref)` returns the same envelope
- [x] Within budget

## Implementation (green, then refactor)

- `src/routes/from-intent.ts`

## Acceptance criteria

- [x] Nonces expire via sweep
- [x] T022 already verifies intents in `public/envelopes/from-intent`; add the 102-vector route tests, the nonce sweep (`nonces/<cid>.<nonce>`, ISO `expiresAt`) and the "available to integrations" template flag (any active template is accepted today)
- [x] E-sign e2e harness reads signing links from `/e2e/mail` (T056 mail capture) instead of clear-text outbox rows, which the now-scheduled drain (T116) can scrub first
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- **53, not 102, vectors through the route.** vectors.json has 102 vectors, but only the 53 `intent` ones reach
  `public/envelopes/from-intent`; the receipt (19), lookup (11), catalog (10) and pairing (9) vectors belong to T062,
  T064 and the pairing settings (T060). `tests/from-intent.routes.test.ts` runs each intent vector in a fresh workerd
  host seeded with the vector's client table and consumed nonces. The route derives secrets from the master key and
  reads the real clock, so each payload's `iat`/`exp` are shifted by `now - verifier.now` (text-level, same digit count:
  the max-length vector stays exactly 8192) and re-signed with the derived secret of the key the vector used, with the
  same tamper applied; malformed/oversize tokens are sent unchanged. Calls start at a second boundary and re-run if they
  straddle one, so the inclusive ±60 s boundaries are tested exactly. Rejections assert no envelope and no burned nonce.
- **Template flag** `integrations` (head only, default off; heads written before T061 count as off). Existing
  templates on a live site must be switched on before Events intents work again (changeset says so). The
  `intent-finish-<id>` cron does not re-check the flag: the intent was accepted when the draft was stored. No storage
  index was added (manifest unchanged); T062's catalogue can query `status: "active"` and filter with
  `availableToIntegrations`, or add an `integrations` index then.
- **Nonce sweep**: hourly `nonce-sweep` (`0 * * * *`), `expiresAt < now` oldest first, 3 pages of 100 (query +
  `deleteMany`), one-shot `nonce-sweep-more` a minute later when a backlog remains: ≤ 7 calls. Added to
  `RECURRING_TASKS`; the shared `SCHEDULES_FLAG` is now `cron:scheduled:v2`, so already-scheduled sites (both cores)
  run `ensure-schedules` once more.
- `fromIntent` moved from `routes/envelopes.ts` to `routes/from-intent.ts` (behaviour unchanged apart from the flag).
- E2E: `esign-journey.ts` reads `/sign/` and `/signed/` tokens from `/e2e/mail?to=` (unique signer address per envelope,
  draining with `/e2e/cron?task=outbox-drain&plugin=semics-esign`); `esign.spec.ts` + `t032-verify-page.spec.ts` pass
  (8/8). No direct outbox reads remain (`signerDoc` still reads the signer row for its assertions).
