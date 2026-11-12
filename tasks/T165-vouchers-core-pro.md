---
id: T165
title: "Vouchers core (Pro): storage, settings, purchase via Stripe, issue, hold and settle"
phase: 8
package: vouchers
edition: pro
status: backlog
model: opus-5.5
size: L
depends_on: [T164]
spec: [R16, R22]
---

# T165 · Vouchers core

## Definition

Create the new plugin `semics-vouchers` (`@semics-tech/emdash-vouchers-pro`, Pro repo `packages/vouchers-pro`),
as specified in T163 §2–§6:

- Manifest, settings with the T163 §3 defaults, and storage: `vouchers`, `orders`, `redemptions`, with a
  ledger on the voucher.
- `public/purchase`: Turnstile, then a Stripe Checkout session tagged `metadata[plugin]=vouchers`.
- `webhooks/stripe`: idempotent; completed issues the voucher, expired closes the order.
- Voucher issue and emails (buyer receipt; recipient on `sendOn` via a daily cron).
- `public/redeem/hold`: a guarded `updateIf` on `version` and the balance. Activity vouchers pay for one
  ticket line. Answers a signed `voucher-hold/1` token.
- `public/redeem/settle`: takes a `voucher-settle/1` token: confirm, release, or credit back.
- A rate limit on redeem routes, and one answer for unknown, expired and void codes.
- Stripe client and webhook verification moved to `pro-kit` and shared with Events Pro, with no change to
  Events Pro's behaviour.

## Tests first

- Domain: balance arithmetic, expiry, activity matching, and ledger entries.
- Host (Stripe faked):
  - purchase, then webhook, then voucher issued, including a replayed webhook;
  - hold and settle for each outcome;
  - **two concurrent holds on one balance**: the total held never exceeds the balance;
  - bad, missing or wrong tokens, and the rate limit.
- Every route and cron within budget (≤ 10 bridge calls).

## Acceptance criteria

- [ ] Every T163 §4–§6 behaviour above.
- [ ] Bundle ≤ 100 KiB and reported in CI.
- [ ] Pro `pnpm verify` green.
