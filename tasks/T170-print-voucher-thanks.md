---
id: T170
title: "Print it yourself: the voucher straight from the thanks page"
phase: 8
package: events-suite, vouchers-pro
edition: pro
status: review
model: opus-5.5
size: S
depends_on: []
spec: []
---

# T170 · Print voucher thanks page

Reported from the LMSC client's first staging voucher purchase (rc.13). The buyer chose delivery "Print it yourself"
and expected the voucher on the page Stripe sent them back to. `/_vouchers/thanks` only said it would be emailed,
which read as if the choice had been ignored.

## Definition

1. **Print delivery thanks page.** For delivery `print`, once the voucher is issued (by the Stripe webhook, so it
   may lag a few seconds), the thanks page shows a "Download / print your voucher" link to `/_vouchers/v?c=<code>`
   (the existing voucher page). Until then it says the voucher is being prepared and refreshes itself
   (`<meta http-equiv="refresh" content="4">`, no JavaScript), at most 15 times (a counter in the query), then says
   it is on its way by email. Other deliveries keep the current copy.
2. **Wording.** The print option in `<BuyVoucher>` and the thanks page make it clear that the buyer can download or
   print it straight after paying, and that an email with the link arrives too.

Design (decided by the orchestrator):

- Vouchers Pro: `success_url` gains `&session_id={CHECKOUT_SESSION_ID}` (Stripe's literal template). A new public
  POST `public/order` takes `{ order, session }` and answers `{ state: "pending" | "issued" | "closed", delivery }`,
  plus `code` only when the order's stored `sessionId` equals `session`, the order is paid with its voucher issued,
  and delivery is `print`. Anything else gets one uniform not-found (no oracle). Per-IP rate limit. The Checkout
  Session id (`cs_…`, long, random) is the bearer secret.
- Events Suite: `VoucherThanks.astro` reads `order` and `session_id`, calls the route in process with
  `callPublicRoute` (POST, so the session id goes into no other URL), and renders the states. It keeps
  `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store`, and puts the code in no URL but the
  `/_vouchers/v?c=` link (voucher/1 §8).
- The Free Events backend is not touched.

## Acceptance criteria

- [x] Tests first in both repos (a failing-test commit, then the fix).
- [x] Vouchers Pro bundle size reported (budget 100 KiB).
- [x] Changesets: events-suite patch (public), vouchers-pro patch (Pro).
- [ ] Reviewed and merged (PRs open; not released).

## Notes

- **The code is not kept anywhere.** voucher/1 §7 stores only the SHA-256 of a code, and the webhook clears
  `pendingCode` once the emails are queued (the outbox scrubs a sent message). So "return the code once issued"
  needed somewhere to read it from. Decision: for a `print` order only, the webhook's last write keeps `printSeal`,
  the canonical code XORed with HMAC-SHA-256(webhook secret, `voucher-print/1.<order>.<session>`) (a one-time pad:
  one key per order and session). Storage alone cannot open it: the secret is a host-encrypted setting. An opened
  code is checked against the voucher's id, so a wrong key or a rotated secret just answers no code, and the page
  says it is on its way by email. The route answers the code only within an hour of `paidAt` (`PRINT_WINDOW_MS`);
  the seal is not deleted afterwards (no cron change), it just stops being answered.
- **Session id stored at purchase.** The webhook used to be the first to store `sessionId`, so a pending order had
  none to check `session` against. `public/purchase` now creates the Checkout Session first and then writes the
  order once with `sessionId` (the order id is made locally, so the session can carry it). The buyer gets the
  Checkout URL only after that write, so nobody can pay for an order that was not stored; a failed write leaves an
  unused session that expires. Bridge calls unchanged.
- **States.** `issued` = `paid` with `issuedAt`; `pending` = `pending`, or `paid` while the emails are being queued;
  `closed` = `expired`, `failed` or `mismatch`. The page shows `closed` ("Payment not completed", contact us) for
  every delivery; `pending`/`issued` for deliveries other than print keep the old copy. A print order issued with
  no code (past the hour, no seal) says it is on its way by email.
- **Not-found.** Malformed input, an unknown order and another session all answer the same `NOT_FOUND` body
  (tested for equality). The session pattern is `cs_(test|live)_\w{1,250}`; the order `vo_` + 32 hex.
- **Rate limit.** `order`: 60 per IP per 10 minutes (the page asks at most 16 times per purchase).
  `public/order` costs 4 bridge calls (5 on a site's first rate-limited call).
- **`{CHECKOUT_SESSION_ID}` encoding.** The session form is `application/x-www-form-urlencoded`, so the braces go as
  `%7B`/`%7D` and Stripe decodes them back to the literal template (as every Stripe SDK sends it). The test reads
  the decoded form value. `cancel_url` stays `?order=<id>&cancelled=1`.
- **Existing assertion changed.** Pro's purchase test expected `success_url` to be exactly `…/thanks?order=<id>`; it
  now expects the new value with `&session_id={CHECKOUT_SESSION_ID}` (and checks `cancel_url` too). The playground's
  t168 spec now follows Stripe's return with the fake session's id and checks the thanks page's download link is
  the emailed code's voucher page.
- **Bytes:** Vouchers Pro `backend.js` 69,680 → 71,201 B (+1,521 B; budget 100 KiB). Free Events `plugin.mjs`
  unchanged (no Events change); the suite's changes are Astro/site-side.
