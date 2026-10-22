---
id: T057
title: "Phase 2 gate: review and budgets"
phase: 2
package: events
edition: free
status: in-progress
model: opus-5.5
size: S
depends_on: [T056]
spec: [Phase 2 exit, EV-NFR-*]
---

# T057 · Phase 2 gate: review and budgets

## Definition

Adversarial review of the events core and UI, as in T034.

## Model

**Opus 5.5**: Judgement-heavy review.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Review recorded in `tasks/reviews/phase-2.md`
- [ ] Every public route has a budget assertion

## Implementation (green, then refactor)

- Run the code-review skill over the phase diff

## Acceptance criteria

- [ ] No open Severity 1 or 2 findings
- [ ] Unique indexes (`bookings.ref`, `attendees.code`, `promo_codes.code`, E-sign `tokenHash`/`clientId`/`nonce`) proven to reject duplicates on real D1 (the in-memory test host does not enforce them; T110 records the finding)
- [ ] Security review of the T053 UI: Origin check on `POST /_events/checkout` and the cancel form; the access token appears only in the `semics_booking_<ref>` HttpOnly cookie and POST bodies, never a URL or the Referer
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```
