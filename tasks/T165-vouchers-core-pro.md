---
id: T165
title: "Vouchers core (Pro): storage, settings, purchase via Stripe, issue, hold and settle"
phase: 8
package: vouchers
edition: pro
status: done
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

- [x] Every T163 §4–§6 behaviour above.
- [x] Bundle ≤ 100 KiB and reported in CI.
- [x] Pro `pnpm verify` green.

## Notes

All code is in the Pro repo (`packages/vouchers-pro`, `packages/pro-kit`, `scripts/generate.mjs`); its README has a
"Vouchers Pro" section. The only public change is a paragraph in `docs/protocol/voucher-v1.md` §8.1 (below), so the
public repo has no test/feat pair for this task.

- **Standalone Pro plugin.** pro-kit assumed a Free core underneath; adapted minimally: `pro.json` without `core`
  makes `generate.mjs` take the package's own `manifest.jsonc` as the base; `editionsTest()` takes `freeDir: null`
  and binds only the Pro build; a new `standaloneBuildSuite()` keeps validate, routes, the 100 KiB budget (printed
  each run: 36.1 KiB), cold start, trust contract and key checks, and drops the superset/Free checks.
- **Licence.** The build's licence product is `events`, so an Events Pro or Suite key unlocks new sales; no new
  licence product (that would change the shared licence module and Paddle plans). Redeeming and the webhook are
  in-flight work. Not added to `npm-trust.mjs` (release of the new package is a follow-up).
- **Stripe in pro-kit.** `stripeRequest`, `verifyStripeSignature` and the setting names moved to pro-kit; Events
  Pro imports them (same requests, headers and answers; its tests pass unchanged). Events Pro backend 245,215 →
  244,853 bytes (239.5 KiB both rounded).
- **No double spend.** One `updateIf` guarded on `version` and the balance (or `usesLeft`); the loser re-reads, at
  most two retries. Proved on a racing fake store (2 and 3 concurrent holds) and on the host (3 concurrent holds).
- **Settle.** The redemption moves first (guarded), then the voucher is reconciled idempotently. `released` is not
  applied until `now > exp + 60`. Late outcomes are kept in `late` for staff.
- **Lookups (protocol addition, documented in §8.1).** Vouchers cannot call Events, so `VOUCHER_NO_BALANCE` with open
  holds carries `lookups` (voucher-lookup/1 tokens) for the suite (T166) to resolve and settle before retrying. The
  same booking ref gets its open hold token back.
- **Pairing.** Client secrets derive from the `pairingMasterKey` secret (`voucher-client/1.` + id); the active
  client id is the undeclared `pairingClientId` setting. Private `pairing/create` / `pairing/revoke` for T167's admin.
- **Activity types** come from the `activityTypes` setting: `eventId, ticketTypeId, priceMinor, label` per line (the
  price is needed to charge for it until Events' catalogue is read, T166/T168).
- **Recipient email on `sendOn`:** an outbox row due at 07:00 UTC that day; the minute `outbox-drain` sends it. The
  `vouchers-daily` job marks expired vouchers and sweeps rate-limit counters. The code lives only in queued email rows
  (and `orders.pendingCode` between payment and queueing) and is scrubbed once sent (R32), as e-sign's tokens.
- **Budgets (measured):** purchase 7 (9 on a site's first call), webhook 5 (replay 3), hold 6 (≤ 10 with races),
  settle 8 (replay 7), outbox drain ≤ 8, daily ≤ 10.
- **For T166:** the suite must pass the visitor's request meta to hold/settle, or every call shares the "unknown" IP
  bucket (20 holds / 120 settles per 10 minutes). Mismatched payments are not refunded automatically (v1).
