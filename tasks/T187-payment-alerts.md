---
id: T187
title: "Stuck mail, daily voucher reconciliation and email state on the voucher page (lmsc-site#151)"
phase: 8
package: shared
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T185]
spec: []
---

# T187 Alerts for payments and vouchers (lmsc-site#151 points 2, 3 and 5)

Oli approved lmsc-site#151 (`scope-approved`, 2026-11-26). Point 1 (Sentry) is the site's own: its PluginBridge
override sends every plugin `ctx.log` error, and a few warnings by `data.code`, to Sentry. So each check here is one
`ctx.log.error` line with a stable code and no personal data.

## Done

- **Point 3, stuck mail** (shared `watchOutbox`, Free Events and E-sign, Vouchers Pro): an `outbox-watch` task every
  5 minutes reports rows pending 15 minutes past their due time as one `outbox.stuck` error (count, up to 5 ids, kinds,
  the first due time). The ids already reported are kept in KV (`outbox:stuck`), so a stuck row is reported once.
  A row that failed for good was already reported when the drain gave up (`outbox.gave_up`, T185). 1 call when nothing
  is stuck, 4 at most. The schedule flag moved to v12, so live sites schedule the new task once.
- **Point 2, daily reconciliation** (Vouchers Pro `vouchers-reconcile`, 06:40 UTC): paid Stripe Checkout Sessions for
  vouchers from the last 7 days (up to 3 pages of 100), older than 15 minutes, against their order (`paid`), voucher
  (issued) and emails (receipt, and the gift email when it goes to the recipient: not failed, not stuck). Read-only.
  A gap is one `vouchers.reconcile_mismatch` error (count, checked, up to 3 `<order>:<reason>`, `more` when pages were
  left); a Stripe failure is `vouchers.reconcile_failed`. A void (refunded) voucher is not chased; a site with no
  Stripe key is skipped quietly. 8 calls at most.
- **Point 5, staff resend**: the voucher page lists the emails that carried its code (sale receipt and gift, Resend,
  each staff "Emailed to" note) with their state. A failed or stuck one shows a warning pointing Administrators at
  "Resend with a new code" (desk staff: ask an Administrator). The Print warning with an email on file and the explicit
  Email or Print choice were already in rc.33 (T181). Resend is one email per click: it is guarded on the voucher's
  version.

## Point 4 (delivery and bounce events): findings, nothing built

- Cloudflare Email Sending reports per-message events (delivered, deferred, bounced, failed, rejected, complained)
  only through Queues event subscriptions (2026-07): no webhooks, nothing signed. A plugin cannot consume a queue; the
  site Worker would, then hand events to a plugin route.
- EmDash 1.2's `ctx.email.send()` returns nothing, and its Cloudflare provider only logs the message id, so a plugin
  cannot match an event to its outbox row. That needs an EmDash change (`send()` returning `{ messageId }`).
- Cloudflare suppresses bounced and complaining addresses itself; a send to one throws `E_RECIPIENT_SUPPRESSED`,
  which the outbox already records as a failure (and gives up on, reported).
- Polling the GraphQL `emailSendingAdaptive` dataset (31 days) with a site API token is a clumsy fallback.
