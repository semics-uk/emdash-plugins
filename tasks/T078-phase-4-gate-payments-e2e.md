---
id: T078
title: "Phase 4 gate: payments E2E"
phase: 4
package: events
edition: pro
status: review
model: opus-5.5
size: S
depends_on: [T074, T075, T076, T077, T072, T071]
spec: [Phase 4 exit]
---

# T078 · Phase 4 gate: payments E2E

## Definition

End-to-end paid booking with Stripe test mode (local fakes now, real test mode once keys exist), expired session releasing holds, webhook replay; review recorded.

## Model

**Opus 5.5**: Money-path review.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Paid journey passes
- [x] Expired session releases holds
- [x] Replay idempotent

## Implementation (green, then refactor)

- `apps/playground/e2e/payments.spec.ts`, `tasks/reviews/phase-4.md`

## Acceptance criteria

- [x] No open Severity 1 or 2
- [x] From T077: Pro returns `next: { type: "pay" }` for a waiver booking at `awaiting_payment` with signed attendees, also on a repeated continue, so "Pay now" works; prove the real Pro pay step with the Pro edition host end to end
- [x] The booking widget sends `promoCode` and can call `public/promo/check` to reveal hidden ticket types (T076: Pro routes exist, the Free UI does not use them yet); a promo-code order through the real Pro reserve and Stripe step is part of the payments E2E
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```

## Notes

- **Review:** `tasks/reviews/phase-4.md`. Severity 1: none. Severity 2: three, fixed (F1 Pro webhook validated
  unsigned waiver attendees; F2 "Pay now" renamed unsigned waiver seats, found here and fixed by T119 at the same
  time, this task's fix dropped in the rebase in favour of T119's, regression tests kept; F3 Free webhook stub
  answered 200 so Stripe never redelivered a payment made after a downgrade, now a raw 503). Severity 3–4 filed on
  the new **T120** or accepted.
- **Where the E2E is.** The playground runs Free only (R40), so the paid journey runs on the real Pro bundle in the
  Pro repo: `packages/events-pro/tests/payments-e2e.editions.test.ts` (15 tests; Stripe faked with
  `host.http.respond`, webhooks signed in the test), driving the real Free UI code (`handleCheckoutForm`,
  `resumePayment`, `promoView`, `paymentView`) through a budgeted in-process dispatcher; every invocation ≤ 10 bridge
  calls. `apps/playground/e2e/payments.spec.ts` covers the Free pages (promo field and endpoint, CSRF, the 503).
  `BookingPage.astro` itself is not run against Pro (its libs are).
- **Promo field (T076 follow-up):** Pro's `public/event` answers `promoCodes: true`; the Free widget shows the field
  in its own form, `POST /_events/promo` (new injected route and package export) checks the code and keeps it in an
  HttpOnly cookie; the order carries `promoCode` only when a code is applied. No shared import (R35).
- **Tests first.** Red seen for: the widget/promo UI tests (module missing), the Pro `promoCodes` flag, F1 (Charles
  `valid` after payment), F2 (Free unit test: seat replanned), F3 (stub had no status). The journey, expiry and replay
  tests passed on first run against existing T073–T077 code (they are the gate's proof, not new behaviour).
- **Verify:** port 4401 was answered by an unrelated site; the playground e2e ran through a temporary copy of the
  config on port 4417 (deleted): 84 passed. Pro tests ran with the Pro worktree's `node_modules` links pointed at this
  public worktree (not committed): **land this public branch before the Pro branch `pro-agent-t078`**, then run
  `pnpm install` in the Pro repo.
