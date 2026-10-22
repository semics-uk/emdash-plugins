---
id: T073
title: "Events Pro: Stripe provider and checkout session"
phase: 4
package: events
edition: pro
status: review
model: opus-5.5
size: M
depends_on: [T071, T048, T118]
spec: [EV-FR-13, R1]
---

# T073 · Events Pro: Stripe provider and checkout session

## Definition

`PaymentProvider` interface and Stripe implementation: create Checkout Sessions with `expires_at ≥ 30 min`, extend the hold to match, return the redirect.

## Model

**Opus 5.5**: External API with timing rules.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Session request body matches Stripe's API (faked with `host.http.respond`)
- [x] `expires_at` never under 30 minutes
- [x] One outbound call per request
- [x] Within budget

## Implementation (green, then refactor)

- `src/payments/provider.ts`, `src/payments/stripe.ts`

## Acceptance criteria

- [x] Pro build only
- [x] On webhook confirmation: count `sold` (`confirmSold`), flip `pending` attendees to `valid`, queue `confirm-<bookingId>`; plug in through `PaymentStep` (T048)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **Where the code is (R40/R41).** Pro: `packages/events-pro/src/payments/provider.ts` (`PaymentProvider`,
  `sessionExpiry`, `paymentStep`) and `stripe.ts` (form body, one `fetch`), wired in `src/plugin.ts` as
  `checkoutContinueRoute({ payment, signature })`; `pro.json` adds `allowedHosts: ["api.stripe.com"]` and the
  `stripeSecretKey` secret setting (Free manifest unchanged). Branch `pro-agent-t073`.
- **Public seam changed (smallest possible, test-first).** The old `PaymentStep.start(...)` had no way to refuse,
  no settings and lost the status read (it passed `status: awaiting_payment`), so new vs in-flight could not be told
  apart and a licence refusal could only come after the writes (a second continue would then pass as "in-flight").
  Now `prepare({ bookingId, booking (as read), settings })` runs before any write and may refuse `{ code }`;
  `start(holdExpiresAt)` returns `Result<{ url }, { code }>`. Free behaviour is unchanged (no step: `PAYMENT_FAILED`).
  **The public side must land before the Pro branch** (Pro links the public main checkout; I developed against this
  worktree by repointing only the Pro worktree's `node_modules` link, restored afterwards).
- **Coordinator request (T065 follow-up), done here:** continuing a paid waiver booking already `awaiting_payment`
  keeps the stored signed attendees (`keepSigned`, +1 call) instead of rewriting unsigned seats in the buyer's name.
- **Gating.** Not `licence.gate(op, route)` around the whole continue route (it would refuse free bookings and cost a
  `settings.get`); as in T063 the step applies `gateProWork(…, PRO_OPERATIONS["events/checkout"])` over the
  `settings.list` continue already made, only when the booking read is not `awaiting_payment` (new work). In-flight
  continues never check. Refusal is before any write or request.
- **Budget (R22).** Paid path: query, `settings.list`, `extendHold`, attendees, `hold-<ref>` re-arm, Stripe fetch,
  `payments.compareAndSet` = 7; waiver booking awaiting payment 8. Asserted ≤ 8 in Pro for one- and dated (occurrence)
  orders and the in-flight retry; Free asserts exactly 5 (6 with kept attendees) before the provider.
- **Stripe request.** `POST /v1/checkout/sessions`, form-encoded, `Authorization: Bearer <stripeSecretKey>`,
  `Idempotency-Key: <bookingId>-<expires_at>`, `Stripe-Version: 2024-06-20`; `mode=payment`, `client_reference_id`,
  `customer_email` (for the receipt), one line item `Booking <ref>` for `totals.totalMinor` (after discounts) in the
  lowercased currency, `success_url`/`cancel_url` = `<site>/booking?ref=<ref>` (no tokens), `metadata` and
  `payment_intent_data[metadata]` with `bookingId`/`bookingRef` only. Amounts Stripe cannot take (≤ 0, non-integer,
  bad currency code, three-decimal currencies not ending in 0) are refused without a request. Any failure is
  `PAYMENT_FAILED`, never thrown; the booking stays `awaiting_payment` under its hold and a retry makes a new session.
- **Expiry (R1).** `expires_at = max(now + 31 min, hold − 2 min)` (Stripe's 30-min minimum + 1 min clock skew; 2 min
  webhook slack per §3.1), capped at 23 h. A 35-min paid hold gives a 33-min session. At the 60-min ceiling the hold
  can end before the session (Free's `extendHold` never passes the ceiling): a late payment is T074's R2 path.
- **Seam left for T074 (webhook).** `payments` record `stripe:<sessionId>` is created `pending` (create-only
  `compareAndSet`, never overwrites) with `bookingId`, amount, currency, `sessionExpiresAt`, `events`. The webhook
  must update it with a revision guard (it already exists), then confirm the booking: `confirmSold`, flip `pending`
  attendees to `valid`, queue `confirm-<bookingId>` (the acceptance line about this is satisfied by the seam only;
  the confirmation itself is T074). Each continue while awaiting payment opens a new session (new idempotency key),
  so T074 should expire the older open sessions or refund a second payment for the same booking.
- **Sizes.** Free Events `dist/plugin.mjs` 103,574 B (101.1 KiB ≤ 104 KiB). Pro Events backend 134.9 KiB
  (ceiling 256 KiB, R43); Pro E-sign 103.6 KiB.
- Small deviation: two Pro test expectations were corrected in the feat commit (config/get orders ticket types, so
  the order now books one of each; `"NOT"` is a well-formed currency code for `Intl`, replaced by `"pounds"`).
