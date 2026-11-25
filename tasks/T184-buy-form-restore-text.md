---
id: T184
title: "Buy a voucher: restore text fields after a refusal (T183 dangling else)"
phase: 8
package: events-suite
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T183]
spec: []
---

# T184 Buy form restores text fields

lmsc-site's staging e2e caught this on rc.33. Released in rc.34 (#88).

- **Cause.** T183's restore loop had a dangling `else`. The `el.value = v` branch bound to the `if` inside the radio
  loop, so text, textarea and select fields never came back; only radios did.
- **Fix.** `<BuyVoucher>` uses `lib/keep-form.ts` (`collectFields`/`applyFields`), like the booking form, through new
  `saveBuyKept`/`takeBuyKept` under the `semics-buy-voucher` key. Values come back once, only on a `?voucher_error=`
  page, while fresh (5 minutes), and never through Back or Forward. Hidden fields are never kept.
- **Tests.**
  - `keep-form.test.ts` covers the buy round trip.
  - e2e `t184-voucher-refusal-keeps-fields.spec.ts` runs on Pro builds only. It fails on rc.33 and passes with the fix
    (run locally against Pro).
