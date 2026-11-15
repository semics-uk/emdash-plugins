---
"@semics-tech/emdash-events-suite": patch
---

"Print it yourself" vouchers can be downloaded straight after paying (T170). `/_vouchers/thanks` reads `order` and
`session_id` from Stripe's return, asks Vouchers' new `public/order` in process (POST), and for a print voucher shows
a "Download / print your voucher" link to `/_vouchers/v?c=<code>` once the webhook has issued it. Until then it says
the voucher is being prepared and refreshes itself every 4 seconds (no JavaScript), up to 15 times, then says it is
on its way by email. Other deliveries keep the old copy. The buying form's print option now says it can be
downloaded straight after paying and that the link is emailed too. Needs Vouchers Pro with `public/order`; with an
older Vouchers the page shows the old copy.
