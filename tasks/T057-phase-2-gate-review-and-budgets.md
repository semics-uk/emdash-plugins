---
id: T057
title: "Phase 2 gate: review and budgets"
phase: 2
package: events
edition: free
status: review
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

- [x] Review recorded in `tasks/reviews/phase-2.md`
- [x] Every public route has a budget assertion

## Implementation (green, then refactor)

- Run the code-review skill over the phase diff

## Acceptance criteria

- [x] No open Severity 1 or 2 findings
- [x] Unique indexes (`bookings.ref`, `attendees.code`, `promo_codes.code`, E-sign `tokenHash`/`clientId`/`nonce`) proven to reject duplicates on real D1 (the in-memory test host does not enforce them; T110 records the finding)
- [x] Security review of the T053 UI: Origin check on `POST /_events/checkout` and the cancel form; the access token appears only in the `semics_booking_<ref>` HttpOnly cookie and POST bodies, never a URL or the Referer
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```

## Notes

- Review: `tasks/reviews/phase-2.md`. 1 Severity 1, 3 Severity 2 (all fixed, test first), 5 Severity 3
  (1 fixed as tests, 4 filed), 7 Severity 4 (filed). Filed on T076, T085, T087, T100, T103, T106, T111.
- **Severity 1 (F1):** EmDash 1.2 sets Astro's `security.checkOrigin: false` on every site, and its own
  CSRF check covers only `/_emdash/api`, so `/_events/checkout` and the booking page's forms had no
  CSRF protection. Now `isCrossSiteRequest` (Sec-Fetch-Site, then Origin vs `url.origin` or the request
  `Host`) answers 403. The first version compared Origin with `url.origin` only, which broke the T056
  load test: without `security.allowedDomains` Astro builds `url` on `localhost`.
- Severity 2: `public/event/ics` served draft/unpublished/orphaned events (F2); cancel after a stale
  claim released seats twice (F3); the outbox give-up log could be the 11th bridge call (F4).
- **For T034 (E-sign):** the same give-up log pattern is in `packages/esign/src/emails/outbox.ts:107`,
  and E-sign's UI form posts likely have the same `checkOrigin: false` gap. Not touched here.
- Unique indexes: cited T110's `spikes/cloudflare/results/unique.json` (real D1); no redeploy.
- "Every public route has a budget assertion" is `tests/public-routes.budget.test.ts`. It went green as
  soon as it was written (every path was already within 10 calls); its red state was its absence. It
  also checks that the routes it exercised equal `PUBLIC_ROUTES`.
- The code-review skill (low) over this branch's diff reported nothing; the phase code itself was read
  in full for the review.
- Phase 2 exit on staging (100 concurrent checkouts on D1) is now a T111 criterion; it is proven locally
  by T056 and passed again in this run's e2e.
