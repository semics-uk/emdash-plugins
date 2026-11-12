---
id: T163
title: "Gift vouchers plugin: spec (buy online, redeem when booking)"
phase: 8
package: vouchers
edition: pro
status: done
model: opus-5.5
size: M
depends_on: [T160]
spec: [R16, R22, R44]
---

# T163 · Gift vouchers: spec

Source: semics-tech/lmsc-site#33 (Oli approved a separate plugin, 2026-11-12). Reference for the buying form and
voucher preview only: lmsc-site PR #31 (closed), `src/pages/gift-voucher.astro` on `feature/modern-gift-vouchers`.

**Status:** approved by Oli 2026-11-12 (with a restricted key for Vouchers and one site webhook endpoint); build tasks T164–T168 filed. The family's open questions (#33) are answered by
**defaults in settings** below, so none of them block the build.

## 1. What it is

A new sandboxed EmDash plugin, `semics-vouchers`. Customers buy gift vouchers online with Stripe Checkout. Vouchers
are redeemed in the Events booking flow and by hand at the clubhouse.

| Decision | Choice | Why |
| --- | --- | --- |
| Edition | **Pro only**: `@semics-tech/emdash-vouchers-pro` in the Pro repo, private npm | Selling and redeeming both need payments, and payments are Pro (Free Events has no Stripe host). A Free voucher plugin would have nothing to redeem against |
| Public repo | The protocol doc and test vectors (`docs/protocol/voucher-v1.md`), the suite wiring, the Free manifest's secret declaration (R44) | Same split as E-sign and Events Pro |
| Separate plugin | Its own storage, settings, Stripe webhook and 128 KiB backend budget | Oli's call. It also keeps Events Pro (about 12 KB under its 256 KiB ceiling) from growing by a whole feature |
| Talking to Events | HMAC-signed tokens, passed by the site's Astro code in-process (the suite) | Plugins can't share storage or call each other (R16, T161). Same pattern as `esign-intent/1` |
| Stripe | The **same Stripe account**. Vouchers keeps its own keys: ideally a Stripe **restricted key** (Checkout Sessions write, Refunds write) so the second copy can do less than Events' key. Stripe and webhook code are shared through `pro-kit`. **One webhook endpoint for the site** (§4a) | Plugins can't read each other's settings (T161), so the keys are pasted twice. A central payments plugin was weighed and turned down for now (Oli, 2026-11-12): Events Pro's payment crons (approval holds, settle sweep) run with no site in between and could not reach it |
| Printable voucher | A voucher page on the site with print styles ("Print or save as PDF"), linked from the email. **No server-made PDF in v1** | A PDF renderer would cost about 30–40 KB of backend and a font. Browser print gives the same result. Can be added later |
| Shop items | **Bookings only** | There is no shop plugin. The protocol allows another client later |

## 2. Kinds of voucher

- **Money** (`money`): a balance in minor units (e.g. £50 = 5000). Can be spent across several bookings until
  it runs out or expires.
- **Activity** (`activity`): tied to one Events ticket type (e.g. "one clay session"). Pays for **one** ticket of
  that type at whatever its price is on the day. Single use, no balance and no change given. Tied by event and
  ticket-type id; renaming the type keeps the voucher working.

The two kinds are stored, listed and reported separately (§7).

## 3. Settings (site defaults, Vouchers admin)

| Key | Default | Notes |
| --- | --- | --- |
| `kinds` | `money,activity` | Turn either off |
| `validityMonths` | `12` | Applies to newly sold vouchers only. Existing vouchers keep their own expiry, which staff can extend |
| `moneyAmounts` | `2500,5000,10000` | Preset amounts, in pence |
| `moneyCustom` | on, `1000`–`50000` | Lets the buyer choose another amount between the min and max |
| `activityTypes` | none | The ticket types offered as activity vouchers, picked from Events' catalogue (read via the suite at setup). The price shown comes from Events |
| `delivery` | `email-buyer,email-recipient,print` | Also `post` (off by default): collects a postal address and lists the voucher under "To post" for staff |
| `scheduledSend` | on | The buyer can pick the day the recipient's email goes out (a daily cron sends it) |
| `currency` | `GBP` | One currency per site |
| Secrets | `stripeSecretKey`, `stripeWebhookSecret`, `licenceKey`, the pairing secret | Same handling as Events Pro |

Events Pro gets one per-site setting, `vouchersPairing` (secret), and shows the code field only when it is set.
Under R44 the **Free** Events manifest must declare that secret first, at about 60 bytes.

## 4. Buying

1. Voucher page (site): the `<BuyVoucher>` Astro component (vouchers package UI), using Emily's draft for the
   look. It asks for the kind, an amount or activity, the buyer's name and email, an optional recipient name,
   email and message, delivery, an optional send date, and Turnstile.
2. `public/purchase` creates a `pending` voucher order and a Stripe Checkout session (`mode=payment`, metadata
   `plugin=vouchers`, `order=<id>`). The browser goes to Stripe.
3. Vouchers' `webhooks/stripe` (reached through §4a) handles `checkout.session.completed`. It is idempotent, keyed by the session id
   as in Events. It issues the voucher (§5), sends the emails, and the success page shows the voucher.
   `expired` closes the order.
4. Refunding a purchase: staff void the voucher (only if it has never been used) and refund in the Stripe
   dashboard. In v1 there is no automatic refund.

### 4a. One Stripe webhook for the site

The suite adds a site endpoint, `POST /_semics/stripe`. Stripe has one endpoint per site and one signing secret.
The endpoint does not verify anything itself. It reads `data.object.metadata.plugin` from the raw body and passes
the raw body and the `stripe-signature` header in-process to that plugin's `webhooks/stripe`: `vouchers` goes to
Vouchers, and anything else, including old sessions with no tag, goes to Events. Each plugin still verifies the
signature with the same webhook secret, so a forged tag reaches only a plugin that rejects it. Events' own
`webhooks/stripe` endpoint keeps working for sites that point Stripe straight at it. Events Pro tags its new
Checkout sessions with `metadata[plugin]=events`, which costs a few bytes.

## 5. The voucher and its code

- **Code:** 80 random bits as 16 Crockford base32 characters, grouped `XXXX-XXXX-XXXX-XXXX`. Typing is forgiving:
  any case, and O/0 and I/1 are treated as the same. The document id is SHA-256 of the normalised code, so the
  database never holds a working code. Staff search by the last 4 characters, the buyer, the recipient or an
  email address.
- **Guessing:** 80 bits, plus the booking form's Turnstile, plus a per-IP rate limit on the redeem route, plus
  the same "not valid" answer for unknown, expired and void codes.
- **Record:** kind, `amountMinor` (money) or `{eventId, ticketTypeId, label}` (activity), `balanceMinor`,
  `currency`, `issuedAt`, `expiresAt`, `status` (`active`, `spent`, `expired`, `void`), buyer, recipient,
  message, delivery, `sendOn`, `version` (for guarded writes), and a ledger of entries (issue, hold, spend,
  release, credit, manual, extend, void), each with who did it and why.
- **Delivery:** emails link to the voucher page `/_vouchers/v?c=<code>`, which shows the code, value or
  activity, expiry and message, with print styles. A recipient's email goes out on `sendOn` (daily cron).
  The buyer always gets a receipt and a copy of the link.

## 6. Redeeming in the booking flow

The protocol is `voucher/1` (§8). The suite runs it on the server, in-process, so it works without JavaScript.

1. The booking form gets a **"Gift voucher code"** field, next to the promo code field. Events Pro reserves as
   today, with any promo code applied first.
2. The suite calls Vouchers `public/redeem/hold` with the code, the booking ref, the amount due, the currency
   and the booking's ticket lines (taken from Events' reserve reply, never from the browser).
3. Vouchers checks the voucher's status, expiry, kind and currency. For an activity voucher it also checks that
   the ticket type is in the order. It then spends with a guarded write (`updateIf` on `version` and the
   balance): `min(balance, due)` for money, one ticket line for activity. It records a **`held`** redemption and
   answers a signed `voucher-hold/1` token: redemption id, kind, amount, booking ref, ticket line, expiry.
4. The suite passes the token to Events Pro on `public/checkout/continue`. Events Pro's wrapper (like the promo
   wrapper) checks the signature and the booking ref. It caps the amount at what is still due (activity: that
   ticket line's price), adds a **"Gift voucher"** line to the booking's discount (`discountMinor` and a
   `voucher` entry on `totals`) and keeps the redemption id on the booking.
5. If nothing is left to pay, Free confirms the booking. Otherwise the buyer pays the rest through Stripe as
   today.

**No double spending.** The balance is taken in step 3 by one guarded write. Two bookings racing for the same
£50 cannot both get it: the second write fails, re-reads the balance and holds what is left, or answers "no
balance left".

**Settling a hold.** Vouchers cannot see the booking, so a hold never goes back to the voucher by itself. Events
signs the booking's outcome as a `voucher-settle/1` token (confirmed, released, or credited back with an amount),
and the suite passes it to Vouchers `public/redeem/settle`:

- when it renders the confirmed page and the booking page (the paths every booking goes through);
- when a code with an open hold is used again: the suite asks Events for that booking's signed outcome first
  (`voucher-lookup/1`), so an abandoned checkout frees its balance on the next try;
- from the booking page after a cancel or refund. The voucher part is **credited back to the voucher** (not to
  the card) and the expiry stays the same;
- by staff: "Release hold" in Vouchers' admin, for a hold whose booking they have checked in Events.

A hold that was never settled is safe: the money stays off the voucher, so the club is never out of pocket.
Holds older than the checkout window show in admin under "Unsettled".

Bookings that need approval (R98): the hold stays until the booking is approved (confirmed) or
declined/expired (released). It is settled the same way.

**Bridge calls (R22):** the Events Pro wrapper adds no storage calls, because token checks are WebCrypto and the
reference rides on Free's own write. Vouchers' hold is at most 4 calls.

## 7. Admin and accounting

- **Vouchers list:** search, filter by kind, status and "expiring in 30 days", and pages "To post" and
  "Unsettled". Each voucher's page shows its ledger and these actions:
  - **void**, with a reason;
  - **extend expiry**;
  - **resend email**;
  - **redeem by hand**: an amount or the activity, plus a note (for the clubhouse);
  - **release a hold**;
  - **issue a voucher by hand**, e.g. for a raffle prize or a voucher paid in the shop. It is flagged
    "not sold online".
- **Reports (CSV and on screen), money and activity kept apart:**
  - **Outstanding liability:** unspent balances of active vouchers. Money in pence; activity as a count and
    the price paid.
  - **Movements by month:** sold, redeemed, expired (breakage), voided, credited back.
  - The reports **do not calculate VAT**. They keep the two kinds separate because UK VAT usually treats them
    differently:
    - a money voucher is usually a multi-purpose voucher, with VAT due when it is spent;
    - an activity voucher is usually a single-purpose voucher, with VAT due when it is sold.

    The accountant must confirm this before launch (#33). This is not tax advice.
- Expired vouchers keep their record and any leftover balance shows as breakage. Staff can still extend one
  after it expires.

## 8. Protocol `voucher/1` (public, `docs/protocol/voucher-v1.md`)

This reuses the `esign-intent/1` primitives:

- base64url, the pairing string (shown once in Vouchers' admin, pasted into Events Pro), and HMAC-SHA-256
  with prefixes for each token type;
- test vectors and the same verification algorithm, with no new crypto.

Tokens:

| Token | Signed by | Holds |
| --- | --- | --- |
| `voucher-hold/1` | Vouchers | redemption id, kind, amount, currency, booking ref, ticket line, expiry |
| `voucher-settle/1` | Events | redemption id, booking ref, outcome, credit amount |
| `voucher-lookup/1` | Vouchers, for Events | a booking ref; Events answers with a `voucher-settle/1` token |

Error codes go in the shared registry: `VOUCHER_INVALID` (one answer for unknown, expired and void),
`VOUCHER_NO_BALANCE`, `VOUCHER_WRONG_ACTIVITY`, `VOUCHER_CURRENCY`, `VOUCHER_UNAVAILABLE` (Vouchers not paired
or not reachable). Booking without the voucher is always possible.

## 9. Budgets

| Bundle | Change |
| --- | --- |
| Free Events `plugin.mjs` (119,392 of 125 KiB budget) | About +60 B: the `vouchersPairing` secret declaration (R44). The "Gift voucher" totals line is UI (Astro) |
| Events Pro (249,833 of 256 KiB) | At most +4 KB: the continue wrapper, settle and lookup answers, settings |
| E-sign | 0 |
| Vouchers Pro | New, at most 100 KiB, measured in CI |

## 10. Build tasks

1. **T164 Protocol `voucher/1`:** the doc, vectors and shared token code (public, test-first).
2. **T165 Vouchers core (Pro):** manifest, storage, settings, purchase, Stripe webhook, code issue, the hold
   and settle routes with guarded writes, emails and the send-date cron.
3. **T166 Events Pro redemption and suite wiring:** the continue wrapper, settle and lookup, the booking-form
   field and its no-JS path, the totals line, the Free secret declaration, and the site webhook endpoint (§4a).
4. **T167 Vouchers admin and reports:** list, search, actions, "To post", "Unsettled", and CSV with the kinds
   kept apart.
5. **T168 UI and journey:** the `<BuyVoucher>` component, the voucher page with print styles, docs, and
   Playwright tests:
   - buy, then redeem the full amount;
   - part-pay, with Stripe paying the rest;
   - two bookings racing for one balance;
   - an abandoned hold freed on the next use;
   - a cancelled booking credited back to the voucher.

## Acceptance criteria (for the spec)

- [x] Both kinds, buying, code, delivery, redeeming, double-spend guard, admin, settings and accounting split
      are covered.
- [x] The family's open questions have defaults in settings.
- [x] The bytes added to Events (Free and Pro) are estimated.
- [x] Oli has seen it (2026-11-12). The build tasks T164–T168 are filed.

Later, not filed: a payments plugin investigation (measure what moving Stripe out of Events Pro would save), if Events Pro's size gets tight.
