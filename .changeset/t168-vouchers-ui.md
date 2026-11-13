---
"@semics-tech/emdash-events": minor
"@semics-tech/emdash-events-suite": minor
---

Gift vouchers on the site (T168). The suite adds `<BuyVoucher />` (the buying form, with a live preview of the card;
no JavaScript needed), `POST /_vouchers/buy` (asks Vouchers for a Stripe Checkout Session and sends the buyer there),
the voucher page `/_vouchers/v?c=<code>` linked from the emails, with print styles ("Print or save as PDF", one A4
page), Stripe's return page `/_vouchers/thanks`, and `/_vouchers/setup`, where an administrator picks the activity
vouchers from Events' catalogue at Events' prices. All only with `eventsSuite({ vouchers })`.

A gift voucher code is now checked with Vouchers before anything is reserved, in the suite's booking flow and in
Events' no-JS checkout (`eventsIntegration({ vouchers })` also exports the module's `checkVoucher`): a mistyped,
expired or spent code is refused on the form, so no booking is held and cancelled and no "cancelled" email is sent.
Setup, settings and the accounting note: `docs/vouchers.md`.
