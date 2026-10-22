---
id: T062
title: "E-sign: receipts, receipt lookup and template catalogue"
phase: 3
package: esign
edition: free
status: backlog
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

- [ ] Receipt vectors pass
- [ ] Lookup with a bad signature fails
- [ ] Catalogue lists only integration-flagged templates
- [ ] Receipt never travels in a query string (E2E URL assertion)

## Implementation (green, then refactor)

- `src/routes/receipts.ts`, `src/routes/catalog.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Events treats an e-sign `from-intent` answer with status `draft` (T113: email retry after a terminal envelope, finished by the `intent-finish-<id>` cron within a minute) as "invitation on its way", not an error
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
