---
id: T168
title: "Vouchers UI (buy page, printable voucher), docs and Playwright journeys"
phase: 8
package: vouchers
edition: pro
status: backlog
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

- [ ] All journeys pass on CI and with Pro linked.
- [ ] Changesets added.
- [ ] Ready for an rc release; LMSC told to install it.
