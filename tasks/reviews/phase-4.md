# Phase 4 gate review: payments (T078)

Adversarial review and end-to-end proof of paid booking across both repos: T073 (Stripe session), T074
(webhook, late payments R2, duplicate refunds), T075 (refunds, cancel guard, settle sweep), T076 (promo codes,
hidden tickets) and T077 (payment return pages, "Pay now", waiver → payment), 2026-10-22. Reviewed at public
main after T119 and Pro main after T119. Severity: **1** exploitable now (data or token leak, oversell,
money) · **2** breaks a stated security or correctness contract with a realistic path · **3**
defence-in-depth or robustness gap, low likelihood · **4** hygiene, documentation, accepted risk.

Severity 1–2 findings are fixed here, test first (`test(T078)` then `fix(T078)`, in both repos). Severity
3–4 findings are filed on T120 (new) or recorded as accepted.

## Summary

| Severity | Found | Fixed here | Filed / accepted |
| --- | --- | --- | --- |
| 1 | 0 | – | – |
| 2 | 3 | 3 (one together with T119) | – |
| 3 | 3 | – | 3 (T120) |
| 4 | 8 | 1 | 7 (T120 or accepted) |

No open Severity 1 or 2 findings.

## How payments were exercised end to end

The playground cannot load Pro (R40), so the end-to-end proof runs in the Pro repo on the **real Events Pro
bundle in workerd** (`events-pro/tests/payments-e2e.editions.test.ts`, 15 tests): `startEdition("pro")`, the
Free bundle for the downgrade (`startEdition("free")`), and the Free e-sign core beside it
(`startSideCore("ESIGN")`) for the waiver journey. Stripe is faked with `host.http.respond` (sessions and
refunds) and every webhook delivery is signed in the test with the endpoint secret.

The buyer's side is the **real Free UI code** the site's pages run, not a re-implementation: the widget's form
handler (`handleCheckoutForm`, what `POST /_events/checkout` does), "Pay now" (`resumePayment`, the booking
page's `intent=resume`), the promo check (`promoView`, what `/_events/promo` and the widget use) and the
booking page's status mapping (`paymentView`). Their in-process calls go through
`locals.emdash.handlePublicPluginApiRoute`, which the test points into the Pro bundle through the T007 harness.
**Every route, hook and cron invocation on every path is asserted within 10 bridge calls (logs count).**
Measured maxima on these paths: reserve 8 (9 with a promo code), continue 5–7 (with the Stripe request),
webhook `completed` 8, `expired` 3, settle one-shot 9, `public/booking` 6, paid cancel 10 (the hard limit, as
T075 recorded), admin refund within 10, `public/promo/check` 6, `sweep-holds` 8, `outbox-drain` 7, e-sign
`from-intent` 9 and `submit` 9.

Journeys:

- widget → reserve → continue → Stripe session (amount, currency, success/cancel URL = `/booking?ref=` only, no
  token anywhere in the request or any route URL) → `checkout.session.completed` → confirmed, attendees valid,
  counters sold → confirmation email; the same delivery again changes nothing; "Pay now" on a confirmed
  booking opens no session;
- promo: a percent code typed in the widget is charged at Stripe (2 × £20 less 25% = £30) and counted once;
  an unlock code reveals the hidden type through `promoView` and sells it; the hidden type without the code
  goes back to the widget; two buyers racing for a code's last use: exactly one is charged the discount, the
  other gets `PROMO_EXHAUSTED`, `used` = 1;
- abandoned: `checkout.session.expired` closes the record while the hold runs; the hold lapses, `sweep-holds`
  releases the seats; "Pay now" then says `HOLD_EXPIRED` and makes no request;
- late payment (R2): seats left → re-reserved and confirmed by the settle one-shot; seats gone (another buyer
  holds the last one) → refunded once (`refund-<sessionId>`), `refunded_unavailable`, no oversell;
- duplicate: "Pay now" twice opens two sessions; both paid → the booking keeps the first, the second is
  refunded with `reason=duplicate`;
- buyer cancel of a paid booking refunds before releasing; the admin's full refund too; both emailed;
- waiver then pay: reserve → continue → intents → e-sign envelope → ceremony → receipt → `awaiting_payment` →
  "Pay now" answers `pay` (**the T077 follow-up**: Pro returns `next: { type: "pay" }` for a waiver booking at
  `awaiting_payment` with signed attendees, also on a repeated continue) → webhook confirms; "Pay now" before
  signing re-issues intents and opens no session; a booking with an emailed adult (F1, F2 below);
- downgrade mid-flow: with the buyer at Stripe the site switches to Free: settings still list (R44), the
  booking page reads `pending`, "Pay now" answers `PAYMENT_FAILED` with no request, the webhook is answered 503
  (F3), the abandoned hold is cancelled and its seats come back; back on Pro, Stripe's redelivery is refunded
  (`cancelled`), never a ticket.

Attacks (all refused, nothing written, checked by a storage snapshot): no signature, wrong secret, timestamp 10
minutes old or ahead, a signature over another body (amount changed), a garbled header; sessions this site
never created (another app on the same Stripe account) naming this booking with a wrong ref, an unknown
booking, or an expiry for a session not ours; price tampering (`totals`, `unitPriceMinor`, `discountMinor` at
reserve, `amountMinor` at continue: `BAD_REQUEST`, no request to Stripe); another booking's ref with my token
at continue, "Pay now", status and cancel (`NOT_FOUND`); promo guessing (`public/promo/check` rate limited
after 30 per 10 minutes, and a guessed code at reserve costs what a booking costs).

The playground e2e (`apps/playground/e2e/payments.spec.ts`, Free cores, real browser and server, 6 tests)
covers what needs the pages: no promo field on a Free event page; `/e2e/promo` renders the real widget as a Pro
site shows it (field in its own form, applied unlock code adding the hidden type, axe clean); no-JS "Apply"
round trip refused on its field with the code never in the URL and no cookie; with JS, Enter in the order's
fields books (the script's checks run) while Enter in the code field applies it; 403 for cross-site posts to
`/_events/promo` and to the booking page's "Pay now" (the return page's other forms were covered by T077); the
Free webhook answering 503 on the real server. T055 and T077 specs ran green beside it.

**Not covered end to end:** `BookingPage.astro` and the suite's `/_events/waiver` running against the *Pro*
bundle in a browser (their libs are, above; the pages with faked answers in T077 and the suite's
`flow.test.ts`); real Stripe test mode (no keys yet; the request and event shapes follow Stripe's API, as in
T073/T074); a deployed Cloudflare site (staging is T111; call counts and CPU are local proxies, R27); real
email delivery (the test host's captured mail).

## Severity 2 (fixed)

**F1 · Paying for a waiver booking validated attendees who had not signed.** On confirm (the webhook and the R2
settle) Pro's `validateAttendees` turned every `pending` attendee `valid`. On a waiver booking `pending` means
"waiver not signed": an adult invited by email who never signed was then admitted at the door, because
check-in refuses only a `pending` attendee (`WAIVER_PENDING`). Every paid waiver event with an emailed adult
was affected. Fix (Pro `payments/webhook.ts`): on a waiver booking pending seats stay pending until their own
receipt arrives; a seat checkout never wrote is added `pending`. Test: the E2E "emailed adult" journey (red:
Charles `valid` after payment; green: `pending`, and the door says "Waiver not signed").

**F2 · "Pay now" on a paid waiver booking renamed unsigned seats to the buyer.** Continue at
`awaiting_payment` without attendee details planned every seat in the buyer's name and kept only seats with a
signature, so an emailed adult who had not signed yet lost their name, email and ticket code each time the
buyer (or the suite's waiver page after the last inline receipt) continued; their pass, the door link and the
later receipt then pointed at the buyer. Found here and fixed at the same time by T119 (its `lockedAttendees`
writes back the stored seats for waiver bookings whose intents are out); this task's own fix was dropped in the
rebase in favour of T119's. Tests: `events/tests/routes/checkout-continue.test.ts` (T078, two continues keep
Charles as stored) and the E2E journey.

**F3 · A Stripe payment made after a switch back to Free was lost.** Free's `webhooks/stripe` stub answered
`{ ok: false }` inside HTTP 200 (R38), which Stripe takes as delivered and never sends again. A buyer who paid
while the site ran Free (the session was opened on Pro) was charged, the hold lapsed, and back on Pro the
`stripe:<sessionId>` record stayed `pending` for ever: the settle sweep only looks at `paid` records. No ticket,
no refund. Fix (public `routes/public.ts`): the Free route is raw and answers **503**
`WEBHOOK_NOT_HANDLED`, so Stripe retries for up to three days and Pro settles the payment once it is back
(confirm, re-reserve or refund, R2). Tests: `events/tests/public-routes.budget.test.ts` (T078, 0 bridge calls),
`tests/routes.test.ts`, playground `payments.spec.ts` (real server), and the E2E downgrade step.

## Severity 3 (filed on T120)

- **F4 · The paid amount is never compared with the booking's.** `markPaid` stores Stripe's `amount_total` as
  `paidMinor` but confirms whatever it is, and the adopt path (record missing) takes any amount. Not reachable by
  a buyer: sessions are created by the server from stored totals and deliveries are signed; it matters only for
  a session someone made on the merchant's account with this booking's id and ref. Defence in depth.
- **F5 · `pending` records are never reconciled.** If deliveries never arrive (endpoint misconfigured, or a site
  on Free for more than Stripe's three days of retries, F3), a paid session leaves no trace the site acts on.
  A sweep step should ask Stripe for the session's status.
- **F6 · A late payment can take a code over its limit by one.** The repair gives an expired booking's use back;
  R2 then re-confirms the booking with its `promoCode` and the next repair counts it again.

## Severity 4

- **F7 · `/_events/promo` and the phase 3 F11 path (fixed here).** `safeReturnTo` passes `/.//host` as `//host`;
  the new endpoint rebuilds its Location from the parsed path (test: `tests/ui/promo.test.ts`), so it never
  redirects off the site. F11 itself stays on T119.
- **F8 · The field shows on every Pro event**, also without codes or with a lapsed licence (the check then answers
  "not valid"). Accepted: telling events with codes apart would cost `public/event` a read.
- **F9 · A lapsed licence at reserve with a code shows "Something went wrong."** The licence codes are not mapped to
  a promo message. T120.
- **F10 · `public/promo/check` does not refuse a draft event** (it refuses orphaned and unpublished), so a code made
  for a draft event names its hidden types. Only an admin can create such a code. T120.
- **F11 · Refund idempotency keys.** All refunds of a session share `refund-<sessionId>`; Stripe answers 400 if
  the same key is reused with other parameters (no such path today), and after 24 hours a retry of an already
  refunded charge fails and retries until the warning. T120.
- **F12 · A session can outlive its hold.** "Pay now" near the 60-minute ceiling opens a session of at least 31
  minutes (Stripe's minimum), so a payment in the gap is a late payment (R2: re-reserved or refunded). Accepted
  (T073 design); recorded for owners in the Pro README.
- **F13 · Promo reserve is 9 calls**, over the 8 target (T076). Accepted; asserted ≤ 10.
- **F14 · Paid cancel uses the hard limit (10 calls).** Ticket-type counters may be left to drift repair (T075).
  Accepted.

## Checked, no finding

- **Signatures.** `t=…,v1=…` HMAC-SHA256 over the raw text body, several `v1`, constant time, ±300 s, checked before
  parsing; 400 without writing; 503 without a secret.
- **Idempotency.** `stripe:<sessionId>` moves only forward through status-guarded `updateIf`s; a replay writes
  only the missed guard; the outbox row `confirm-<id>` marks side effects done; refunds are one request with an
  idempotency key; refund emails are create-only.
- **Holds and sessions (R1).** `expires_at ≥ now + 31 min`, the hold outlives the session by 2 minutes until the
  ceiling; an expired session never releases seats while the hold runs; the sweeper is the source of truth.
- **R2.** Re-reservation from the config's catalog guarded on capacity; refusal refunds and moves to
  `refunded_unavailable`; a booking an expirer is releasing is retried.
- **Cancel guard.** Free refuses to cancel a paid confirmed booking; Pro refunds first and clears the claim on a
  failed refund; an abandoned hold whose payment arrives later is refunded (`cancelled`).
- **Promo.** Codes normalised before storage and lookup (R26); the redemption is guarded on `active` and
  `used ≤ maxUses − 1` after the draft exists; a miss closes the draft; percent rounding once per order; fixed
  capped at the subtotal; currency checked; hidden types only through an unlock code (reserve re-checks).
- **Tokens in URLs.** The access token stays in POST bodies and the HttpOnly cookie; Stripe gets the ref only;
  the promo code travels in POST bodies and an HttpOnly cookie, never a URL.
- **CSRF.** `/_events/checkout`, `/_events/promo` and the booking page's forms (cancel, redeem, receipt, resume)
  check `isCrossSiteRequest` before reading the form.
- **Bundles (R47).** Free Events backend within 112 KiB; the promo UI is in the native half, not the backend.

## The promo field (T076 follow-up, built here)

`public/event` answers `promoCodes: true` in the Pro build (no extra call). The Free widget then shows "Promo
code" with "Apply code" in a separate hidden form, posted to the injected `POST /_events/promo`
(`src/astro/lib/promo.ts`): Origin check, `public/promo/check`, an HttpOnly Lax cookie `semics_promo_<eventId>`
for 30 minutes, back to the widget. On render the widget checks the cookie's code again, lists an unlock code's
hidden types and puts the applied code in the order as `promoCode`; checkout sends the key only when present
(Free's reserve refuses unknown keys). No shared import in the UI (R35).

## Code review of the phase diff

Read in full: Pro `payments/{provider,stripe,stripe-events,webhook,refunds,refund-mail,sweep}.ts`,
`promo/{reserve,check,register,repair}.ts`, `domain/promo.ts`, `plugin.ts`; public
`routes/{checkout-continue,public,booking}.ts` (cancel and refund seam), `astro/lib/{checkout-form,payment,
widget,call}.ts`, `BookingPage.astro`, `BookingWidget.astro`, `client/booking.ts`. Correctness findings are
F1–F3 (fixed); the rest are above.
