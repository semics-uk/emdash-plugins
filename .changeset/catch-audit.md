---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
"@semics-tech/emdash-events-suite": patch
---

T185 (#79): errors that were swallowed now reach the site's own logs. Site-side code logs to console: a crashed or unreachable plugin route, a Stripe delivery no plugin handled, a voucher hold Vouchers would not settle, and a waiver that could not be voided or forwarded. In the backend, three failures are logged: a checkout draft that could not be stored, Turnstile being unreachable or rejecting the site's secret, and an E-sign invitation that could not be queued. Every other server catch now says why staying quiet is right, and a script test keeps it that way.
