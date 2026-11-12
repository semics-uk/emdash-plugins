---
id: T166
title: "Events Pro voucher redemption, suite wiring and the site Stripe webhook endpoint"
phase: 8
package: events-suite
edition: pro
status: backlog
model: opus-5.5
size: L
depends_on: [T165]
spec: [R16, R22, R44]
---

# T166 · Redeeming in the booking flow

## Definition

As specified in T163 §4a and §6.

- **Free Events:**
  - declare the secret `vouchersPairing` (R44), about +60 B, reported;
  - show the totals line "Gift voucher" (UI);
  - add the "Gift voucher code" field to the booking widget (UI).
- **Events Pro:**
  - a `public/checkout/continue` wrapper that verifies `voucher-hold/1`, caps the amount at what is due, and
    writes the discount and the redemption id on Free's own write;
  - `voucher-settle/1` for confirmed, released or credited back, plus the `voucher-lookup/1` answer;
  - tag Checkout sessions `metadata[plugin]=events`;
  - at most +4 KB.
- **Suite:**
  - `lib/flow.ts`: reserve, then hold, then continue with the token; settle when rendering the confirmed and
    booking pages; lookup, then settle when reusing a code that has an open hold. No JS needed.
  - `POST /_semics/stripe`: routes by `metadata.plugin`; each plugin verifies the signature.

## Tests first

- Pro editions (workerd, real bundles):
  - full and part redemption;
  - activity voucher on the wrong ticket type;
  - a tampered token;
  - a hold for another booking;
  - an approval booking (R98), declined, then released.
- Suite: flow outcomes and webhook routing (forged tag reaches a plugin that rejects it; untagged goes to
  Events).
- Events Pro without pairing: no field, behaviour unchanged.

## Acceptance criteria

- [ ] Existing sites see no change until paired.
- [ ] Bytes reported for Free Events and Events Pro, within T163 §9.
- [ ] `pnpm verify` green in both repos.
