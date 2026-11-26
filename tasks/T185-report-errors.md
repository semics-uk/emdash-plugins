---
id: T185
title: "Errors reach the host site's log: report helper, outbox, Stripe webhooks; version-PR CI fixed"
phase: 8
package: shared
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T181]
spec: []
---

# T185 Report errors through ctx.log (#79)

Oli approved issue #79's reworked scope on 2026-11-24. Errors go to the host site's own logging (`ctx.log`, a 5xx).
No new settings, panels or alerts. Items 1–3 were released in rc.35 (#93, Pro #24). Item 4 is in rc.36 (this PR).
Item 5 is still open.

## Done

- **Item 1, `report()`.** `report(log, level, code, data)` is in `packages/shared/src/report.ts`. The message is a
  stable code, also repeated in the data. Every text value loses links and email addresses, and ids stay whole.
  `scrubText` also drops 20+ character tokens, for free text such as a provider's error.
- **Item 2, outbox.** `drainOutbox` takes `log`.
  - A message's first failure is `outbox.send_failed` (warn) and giving up is `outbox.gave_up` (error).
  - Each tick writes at most one line of each, with count, kind and the scrubbed error. That adds at most 2 bridge
    calls, so a default tick stays at 10.
  - The stored `lastError` is scrubbed of addresses too.
  - Wiring: Events goes through its tick meter, E-sign passes `ctx.log`, and Vouchers Pro passes `ctx.log` (before
    this, Vouchers never logged a give-up).
- **Item 3, webhooks (Pro).** Events Pro and Vouchers Pro log three things, with what Stripe gets back unchanged:
  - `*.webhook_not_configured` (error, the 503);
  - `*.webhook_signature_failed` (warn, with the reason; a rotated secret looks like this);
  - `*.webhook_retry` (error, with the Stripe event id, type and error name, whenever the webhook answers 500).

  Events Pro writes these only while the delivery has a bridge call left.
- **Version-PR CI (#92).** `release.yml` read changesets/action v1's `pullRequestNumber`; v2 calls it `pr-number`.
  `ci.yml` also didn't classify a dispatched run on the version branch, and didn't fetch `main` for the changeset
  check. Since rc.35 the version PR's checks pass with no approval.

## Sizes

Free Events backend 121,271 B (2,633 B under the hotfix room). Pro Events 253.5 of 256 KiB. Vouchers 83.0 of 100 KiB.

- **Item 4, the server `catch` audit.** All 131 sites were triaged. The ones that matter now report:
  - **Site side, through `siteLog()` (to `console`, so it costs no bundle bytes or bridge calls).** `siteLog()` is
    exported from Events' `astro/lib/call.ts`; E-sign has its own copy. It logs:
    - `events.route_call_failed` / `esign.route_call_failed` (warn), once, in `callPublicRoute`'s `failure()`;
    - `suite.stripe_forward_failed` (error) when a Stripe delivery no plugin handled gets a 5xx;
    - `suite.voucher_checkout_url_invalid`;
    - `suite.voucher_settle_refused`;
    - `suite.waiver_void_failed` and `suite.waiver_reconcile_failed`.
  - **In the backend.**
    - `events.checkout_draft_failed`: a storage outage was hidden as INTERNAL. It is early in the route, so a call
      is to spare.
    - `turnstile.unavailable` and `turnstile.secret_rejected` from `verifyTurnstile`, given `log`. Checkout passes
      it. A visitor's own bad token is not logged.
    - `esign.invite_queue_failed`.
  - **The rest** carry a one-line reason: a parse fallback, retried by a sweep, settled by drift repair, shown to the
    admin, or a call budget with no room. The reserve failure after `reserve()` stays unlogged, because the reserve
    and the closing write may use the route's 10 calls.
  - **The guard.** `scripts/catch-check.mjs`, run by `catch-check.test.mjs` in the Script tests gate, fails on any
    server catch with no comment, report, log or throw near it.

## Open

- Item 5: a test per package that a failed email never fails a booking or payment; staff screens show a plain retry
  message.
