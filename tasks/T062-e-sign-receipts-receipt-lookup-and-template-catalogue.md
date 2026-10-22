---
id: T062
title: "E-sign: receipts, receipt lookup and template catalogue"
phase: 3
package: esign
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T061]
spec: [ES-FR-14]
---

# T062 · E-sign: receipts, receipt lookup and template catalogue

## Definition

Issue receipts at completion (fragment redirect), `public/receipts/lookup` and `public/templates/catalog` with client-signed requests.

## Model

**Opus 5.5**: Protocol issuance path.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Receipt vectors pass
- [x] Lookup with a bad signature fails
- [x] Catalogue lists only integration-flagged templates
- [x] Receipt never travels in a query string (E2E URL assertion)

## Implementation (green, then refactor)

- `src/routes/receipts.ts`, `src/routes/catalog.ts`

## Acceptance criteria

- [x] Within budget
- [ ] Events treats an e-sign `from-intent` answer with status `draft` (T113: email retry after a terminal envelope, finished by the `intent-finish-<id>` cron within a minute) as "invitation on its way", not an error
- [x] The template catalogue lists only templates where `availableToIntegrations(head)` is true (T061); cover the remaining receipt/lookup/catalog vectors from `docs/protocol/vectors.json` through the real routes
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- **Events `draft` criterion left open (not e-sign code).** packages/events has no from-intent caller yet. T063 owns it
  and is running in parallel, and this task must not touch packages/events. Instead, protocol §8.1 now says that `status`
  MAY be `"draft"` for `delivery: "email"` and that clients MUST treat it like `"sent"`, and the orchestrator was told to
  pass this on to T063. Tick this box when T063 (or T064) handles it.
- **Receipt vectors.** e-sign issues receipts, so every untampered receipt vector signed under `esign-receipt/1` is
  reproduced byte for byte from the envelope state it describes (`domain/receipts.ts`), and all 19 also run through the
  shared verifier. Of the schema-breaking ones, the issuer refuses uppercase hex, completed-without-finalHash and unknown
  statuses, and always nulls the hashes for non-completed receipts. All 11 lookup and 10 catalog vectors run through the
  real routes in workerd. `tests/vectors.ts` re-mints them the T061 way: time fields (`iat`/`exp`/`ts`/`at`) are shifted,
  the token is re-signed with the derived secret, and a "payload segment replaced" vector is signed over `<type>/valid`.
- **Redirect.** Submit, decline and a closed session return `returnUrl` + `receipt` for an integration's envelope.
  `/sign/[token]` answers the sign/decline form post with a 303 to `returnUrl#receipt=<token>`, keeping no-referrer and
  no-store. A plain visit to a closed envelope only shows the "Return to the site" link with the fragment. A host
  rendering `<SigningCeremony>` itself gets the same URL as `view.returnUrl` and can use `ceremonyRedirect(view)`
  (exported). The redirect receipt has `pdfSha256: null`, because the PDF is built just after (§8.2). Lookup issues the
  full receipt once the PDF is stored.
- **`at`.** `completedAt` for completed envelopes. Decline and void now write `closedAt` (new optional field); older
  closed envelopes fall back to `updatedAt`.
- **Budgets.** Submit is still 9 calls: `settings.get("consentVersion")` became `settings.list()` so that the master key
  is available. Decline is 8 (+1 for settings). Lookup is 3, catalog is at most 5 (3 pages of 200 active heads), and
  session is unchanged.
- **Settings read.** Because submit and decline now use `settings.list()`, an unreadable secret
  (`EMDASH_ENCRYPTION_KEY` missing or changed) fails them the same way it already failed `public/session`. This is no new
  failure mode for the ceremony.
- **No rate limit on lookup/catalog.** The requests are HMAC-authenticated, read-only, live 5 minutes and are sent
  server-to-server in-process (§5.4). A per-IP limit would add 2 calls and protect nothing the signature does not.
  `CLIENT_UNKNOWN`/`CLIENT_REVOKED` are returned precisely, as from-intent does and as the vectors expect.
- **Lookup "most recent"** is the highest `_<attempt>` suffix (deterministic `envelopeIdForRef` ids), with `createdAt`
  as the tie-break. Results are re-filtered by cid in code, beside the scoped query.
- **E2E.** `apps/playground/e2e/t062-receipts.spec.ts` asserts the 303 Location, that the landing URL has the receipt
  only in the fragment and keeps its own query, and that no request or navigation URL carries it in a query or path. It
  then checks lookup and catalogue. It was written before the implementation but not run red (the redirect's unit tests
  in `tests/ui/sign.test.ts` were seen failing). `serve.mjs` now gives the server a fixed test `EMDASH_ENCRYPTION_KEY`
  (an env value overrides it).
- `from-intent` now uses the shared `routes/integration.ts` client lookup (behaviour unchanged).
