---
id: T074
title: "Events Pro: Stripe webhook and late payments"
phase: 4
package: events
edition: pro
status: done
model: opus-5.5
size: M
depends_on: [T073, T071]
spec: [EV-FR-13, EV-NFR-05, R2]
---

# T074 · Events Pro: Stripe webhook and late payments

## Definition

`webhooks/stripe` verifies signatures with timestamp tolerance, writes `payments` documents idempotently, confirms bookings, and re-reserves or auto-refunds late payments.

## Model

**Opus 5.5**: Money correctness.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Replay of the same event changes nothing
- [x] Bad signature and stale timestamp rejected
- [x] Late payment re-reserves when seats remain, refunds when sold out
- [x] Within budget

## Implementation (green, then refactor)

- `src/routes/stripe-webhook.ts`

## Acceptance criteria

- [x] Raw body verification
- [x] From T073: update the existing `pending` `stripe:<sessionId>` record with a revision guard (it already exists); then `confirmSold`, flip `pending` attendees to `valid`, queue `confirm-<bookingId>`; each continue while awaiting payment opens a new session, so expire older open sessions or refund a second payment for the same booking; a payment after the hold lapsed follows R2 (re-reserve or refund)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **All Pro code** (Pro repo, branch `pro-agent-t074`): `packages/events-pro/src/payments/webhook.ts` (route and
  settle one-shot), `stripe-events.ts` (signature check, event parser), `stripe.ts` (`stripeRefund`),
  `src/free-domain.ts` (re-exports Free domain modules by link path, as `reports/export.ts` already does),
  `plugin.ts` (overrides the Free `webhooks/stripe` stub; cron runs `stripeCron` before reports), `pro.json`
  (`stripeWebhookSecret` secret setting). No Free code changed (Free bundle unchanged); the planned
  `src/routes/stripe-webhook.ts` lives in Pro instead. Public change: a CONTEXT.md note that Pro now composes these
  Free domain functions, so their signatures are de facto API.
- **Signature:** `t=…,v1=…` HMAC-SHA256 of `t.rawBody` with the whsec secret, any of several `v1`, constant-time,
  ±300 s, checked before parsing. Raw route answers: 400 bad/stale/missing signature, 503 no secret configured,
  500 retry, 200 otherwise.
- **Idempotency:** `stripe:<sessionId>` moves `pending → paid|expired|failed` and `paid → refunded` only through
  status-guarded `updateIf` (stores `paidEventId`, `paymentIntent`); a replay of the same event writes nothing (reads
  plus the missed guarded update) and resumes unfinished work (outbox `confirm-<id>` marks the side effects done).
- **Confirm:** booking guarded on `{ status: "awaiting_payment", releaseClaimedAt: null }` (also confirms a hold that
  has just lapsed but is not yet claimed: its seats are still reserved); sets `payment: { provider, ref }`.
- **Second payment:** refunded (reason `duplicate`) rather than expiring older sessions in continue (keeps continue's
  budget). A payment for a cancelled, refunded or missing booking is refunded as well. Refunds are one
  `POST /v1/refunds` with idempotency key `refund-<sessionId>`.
- **R2** runs in the `stripe-settle-<sessionId>` one-shot (fresh budget): re-reserve through Free `reserve` from the
  config `catalog` (the guards pin capacity), move `expired → confirmed` (clearing `releaseClaimedAt`); otherwise
  refund and move `expired → refunded_unavailable`. A booking an expirer has claimed is retried in 2 min; after 8
  attempts it logs a warning and stops.
- **Expired / async failed:** the record is marked; seats are released only by the hold rules (at once via Free
  `expireBookings` if the hold has already lapsed, else by `hold-<ref>` or the sweeper).
- **Budget (measured):** webhook confirm 8 (one ticket type), 9 for a dated event (sold counters may use the hard
  limit, as in Free's confirm; every other step is planned within 8); replay 5; bad signature 1; hand-off to the
  one-shot 5; settle refunds 5 to 8; R2 re-reserve 9 to 10 (including sold counters) plus a 6-call finish step.
- **Follow-ups:** buyers get no refund email from the plugin (turn on Stripe receipts, or T075). If scheduling the
  one-shot fails, the webhook answers 500 so Stripe redelivers. Owner Stripe setup is in the Pro README.
