---
id: T168
title: "Vouchers UI (buy page, printable voucher), docs and Playwright journeys"
phase: 8
package: vouchers
edition: pro
status: review
model: opus-5.5
size: M
depends_on: [T166, T167]
spec: []
---

# T168 · Vouchers UI and journeys

## Definition

- `<BuyVoucher>` Astro component. Use Emily's draft (lmsc-site PR #31) as the visual reference.
- The voucher page `/_vouchers/v?c=`, with print styles ("Print or save as PDF").
- Docs page: setup (restricted key, one webhook endpoint, pairing), settings, and the accounting note.
- Playwright on the playground, with Pro linked and Stripe faked as in T159:
  - buy, then redeem the full amount;
  - part-pay, with Stripe paying the rest;
  - two bookings racing for one balance;
  - an abandoned hold freed on the next use;
  - a cancelled booking credited back to the voucher;
  - the printout (A4 `page.pdf`).

## From T166

- Check a code before reserving (a Vouchers `public/redeem/check` route, or the suite's hold dry-run), so a mistyped or expired code
  is refused on the form without reserving, and with no "booking cancelled" email. Today a refused code cancels the held booking.
- Read activity voucher prices from Events' `public/event` instead of the `activityTypes` setting's price.
- Events Pro is 252,061 B after T166 (+7,208 B, over T163's +4 KB estimate; 10,083 B left under 256 KiB). Add nothing to Events Pro here.

## Acceptance criteria

- [x] All journeys pass on CI and with Pro linked. (CI: the Pro-only spec skips, as T135's do; Pro linked: 7/7.)
- [x] Changesets added.
- [ ] Ready for an rc release; LMSC told to install it. (Ready; telling LMSC is the orchestrator's, after the release.)

## Notes

Public branch (this one) and Pro branch `pro-t168-vouchers-ui` (`.pro-worktrees/t168`). Events Pro: nothing added.

- **Bytes.** Free Events `plugin.mjs` 119,392 → 119,392 (+0: all public changes are UI and suite). Events Pro
  252,061 → 252,061 (+0, not touched). Vouchers Pro backend 67,671 → 69,680 (+2,009; of 100 KiB).
- **Where the UI lives: the public suite**, not the Pro package. `<BuyVoucher>`, the pages and the endpoint only call
  Vouchers' public routes (as Events' UI does for Events Pro); the suite already owns the vouchers wiring and the
  playground e2e. Vouchers Pro stays a backend. New: `BuyVoucher.astro`, `VoucherCard.astro`, `VoucherPage.astro`
  (`/_vouchers/v`), `VoucherThanks.astro` (`/_vouchers/thanks`, Vouchers' default return path), `buy-endpoint.ts`
  (`/_vouchers/buy`), `VouchersSetupPage.astro` (`/_vouchers/setup`), `lib/buy.ts`, `lib/vouchers-setup.ts`; all
  injected only with `eventsSuite({ vouchers })`.
- **Check before reserve.** Vouchers `public/redeem/check` (4 calls, own per-IP scope 30/10 min): with `lines` it is
  the hold's dry run (pairing, dead code, currency, activity, nothing left and no open hold); without, the voucher
  page's view (no email addresses). The suite flow and Events' `/_events/checkout` (new optional `check` hook,
  `checkVoucher` exported by the integration beside `holdVoucher`) call it before reserve; a missing or failing route
  never blocks. Currency is not known before reserve, so the hold still checks it.
- **Activity prices from Events.** Vouchers cannot read Events and a browser-sent price cannot be trusted, so the
  price stays in Vouchers' `activityTypes` (what is charged) and `/_vouchers/setup` (administrators) fills it from
  Events' `public/events` / `public/event` through the host's settings write, with a "price moved" marker; save again
  after a price change. This is T163 §3's "picked from Events' catalogue (read via the suite at setup)". Not a live
  read at purchase time.
- **New Vouchers route `public/options`** (1 call): what `<BuyVoucher>` offers; no secret.
- **Docs:** `docs/vouchers.md` (install, restricted key, one webhook endpoint, settings, setup page, pairing,
  accounting note).
- **Playwright** `e2e/t168-vouchers.spec.ts`, 7 journeys, passing with Pro linked (Events Pro + Vouchers Pro, fake
  Stripe, deliveries through `/_semics/stripe`): buy + voucher page + A4 `page.pdf` (one page, card within the
  printable area), full redemption, part-pay, cancel credited back, race, abandoned hold freed (holds moved past their
  window in `data.db`, then `sweep-holds`), mistyped code refused with nothing reserved. T135/T159 Pro specs still pass
  with Vouchers linked. `link-pro.mjs` links Vouchers only when it is built; `astro.config.mjs` passes it on.
- **Changed existing assertions (extended):** `tests/flow.test.ts` "reserve, then hold, then continue" now expects
  `public/redeem/check` first (indices shifted by one); `fake-stripe.ts` sessions also carry `metadata.plugin/order`.
- **Not covered by e2e:** `/_vouchers/setup` (needs a signed-in browser session; unit-tested), activity voucher
  purchase through the form (domain and editions tests cover activity holds). Emails are still plain text.
