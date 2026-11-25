---
id: T183
title: "Buy a voucher: refusals name the field, land on the form, keep what was typed"
phase: 8
package: events-suite
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T168, T182]
spec: []
---

# T183 Buy form refusals

Reported by the lmsc-site session on 2026-11-24 (lmsc-site #148). Released in rc.33 (#84).

- **The alert.** `buyMessage()` says "Please check the highlighted fields: <labels>." A `BAD_REQUEST` with no fields
  (Vouchers refused what the form passed) says the details could not be accepted, instead of pointing at highlights
  that aren't there. The message and address textareas get `aria-invalid`.
- **In view.** A refusal redirects to `…#semics-buy-voucher` (`BUY_FORM_ID`). Before, the alert sat about 3,000px down
  on a phone.
- **Kept.** The form saves its fields to the tab's `sessionStorage` on submit and restores them once, only on a
  `?voucher_error=` page. Nothing typed goes in the URL.
- **CR LF.** `readBuyForm` turns CR LF into LF in the message and address, so the 500 limit matches the textarea's
  `maxlength`.
- **Gap.** The restore script has no browser test.
