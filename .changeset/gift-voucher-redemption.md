---
"@semics-tech/emdash-events": minor
"@semics-tech/emdash-events-suite": minor
---

Gift vouchers in the booking flow (T166). Events declares the `vouchersPairing` secret that Events Pro reads (R44; the Free backend is unchanged), and its widget shows a "Gift voucher code" field when `public/event` answers `vouchers: true` (Events Pro paired with Vouchers). The booking page shows a "Gift voucher" line in the totals. `eventsIntegration({ vouchers: { pluginId, module } })` lets the no-JS checkout hold the code between reserve and continue; `callPublicRoute` keeps a refusal's extra fields in `error.details`.

The suite takes `eventsSuite({ vouchers })`: its booking flow holds the code with Vouchers (settling abandoned holds through Events' lookup first), the booking page settles each hold's outcome, and the site gets one Stripe webhook endpoint, `POST /_semics/stripe`, which passes each delivery to the plugin its session is tagged for (Events by default). Without `vouchers` a site is wired exactly as before.
