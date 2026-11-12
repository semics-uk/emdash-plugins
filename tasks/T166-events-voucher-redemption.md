---
id: T166
title: "Events Pro voucher redemption, suite wiring and the site Stripe webhook endpoint"
phase: 8
package: events-suite
edition: pro
status: review
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

- [x] Existing sites see no change until paired.
- [ ] Bytes reported for Free Events and Events Pro, within T163 §9. (Reported; Free within, Events Pro over: see Notes.)
- [x] `pnpm verify` green in both repos.

## Notes

Public repo (this task's branch) and Pro repo (`pro-agent-a8567d10f94dac075`, `.pro-worktrees/agent-a8567d10f94dac075`).
`packages/vouchers-pro` was not edited (T167 owns it); Events Pro's test config only builds it.

- **Bytes.** Free Events backend 119,392 → 119,392 (+0: a setting lives only in the manifest, not in `plugin.mjs`).
  Events Pro backend 244,853 → 252,061 (+7,208): about 4.1 KB of wrappers and rules (`src/vouchers`), 2.7 KB of the
  shared voucher/1 token code (verify, sign, schemas; not in the bundle before) and 0.4 KB for merging
  `VOUCHERS_ERROR_CODES`. That is over T163 §9's "+4 KB" estimate; it is 10,083 bytes under the 256 KiB Pro
  ceiling (R43). Ways to get it back, if wanted: a leaner shared voucher module (schemas per type, tree-shakable),
  or the T163 "payments plugin" investigation.
- **Free Events (public).** `vouchersPairing` secret "(Pro)" (R44). UI: "Gift voucher code" (`voucherCode`) in
  `<BookingWidget>` only when `public/event` says `vouchers: true`; "Gift voucher" line in `<BookingStatus>` from
  `totals.voucherMinor`; `VOUCHER_*` widget messages (en, ar). `handleCheckoutForm` takes a `voucher` hook (the
  suite's, through `eventsIntegration({ vouchers })`, which adds virtual-config exports only then: pages read them by
  namespace import so a site without vouchers gets byte-identical config). `callPublicRoute` now keeps a refusal's
  extra top-level fields as `error.details` (needed for Vouchers' `lookups`).
- **Suite.** `eventsSuite({ vouchers })` (optional). `lib/voucher.ts` (`holdVoucher`: Events `public/booking` for
  the lines and amount due, then the hold, lookups → settle → one retry; `settleVoucher`), `lib/flow.ts` (reserve →
  hold → continue with `voucherHold`), `reconcileBooking` settles `booking.voucher.settle`, `lib/stripe.ts` +
  `stripe-endpoint.ts` (`POST /_semics/stripe`, injected only with vouchers). The visitor's IP headers reach Vouchers
  through `callPublicRoute`. A refused code cancels the held booking (as a refused continue already did), which sends
  the "cancelled" email; a quieter abandon would need a core change (follow-up).
- **Events Pro.** `src/vouchers/settle.ts` (pure: pairing, `applyHold`, `settleOutcome`, `mintSettle`) and
  `routes.ts` (continue, booking, event wrappers; `public/voucher/lookup`); `metadata[plugin]=events` on sessions;
  `useErrorCodes({ ...ERROR_CODES, ...VOUCHERS_ERROR_CODES })`. The voucher's amount is `totals.voucherMinor` (the
  "`voucher` entry on totals" of T163 §6) and also added to `discountMinor`; the booking keeps `voucher: { rid, cid,
  kind, amountMinor }`. Only a `held` booking takes a hold (no payment session or intents yet). Lookup deviation: a
  booking still `held` that does not carry the `rid` answers `pending`, not `released` (continue may yet bring
  that hold; Vouchers would not release before `exp + 60` anyway).
- **Changed existing assertions (extended, not weakened):** `packages/events/tests/manifest.test.ts` (the secrets
  list and `PRO_RESERVED_SECRETS` gain `vouchersPairing`); Pro `tests/payments.unit.test.ts` (the exact session
  form gains `metadata[plugin]: "events"`, which T163 §4a requires); Pro `tests/pro.build.test.ts` (Pro-only routes
  gain `public/voucher/lookup`). Pro `trust-contract.json` lists the new public route (a deliberate pre-1.0
  trust-contract addition).
- **Not done here:** Vouchers' purchase still prices activity vouchers from its `activityTypes` setting (format
  unchanged); reading Events' prices from `public/event` is left to T168. No playground spec (the playground cannot
  load Pro); the flow is covered by the suite's faked-host tests and the Pro workerd tests with both real bundles.
