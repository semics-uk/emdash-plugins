# Gift vouchers: setup and settings

Gift vouchers are sold online through Stripe Checkout and redeemed in the Events booking flow. They need three
things on one site: **Events Pro**, **Vouchers Pro** (`@semics-tech/emdash-vouchers-pro`) and the suite
(`@semics-tech/emdash-events-suite`), which carries signed tokens between the two in process. The design is in
[tasks/T163-gift-vouchers-spec.md](../tasks/T163-gift-vouchers-spec.md); the wire protocol is
[protocol/voucher-v1.md](protocol/voucher-v1.md).

## 1. Install

```js
// astro.config.mjs
import eventsPro from "@semics-tech/emdash-events-pro";
import vouchersPro from "@semics-tech/emdash-vouchers-pro";
import { eventsSuite } from "@semics-tech/emdash-events-suite";

const suite = eventsSuite({ events: eventsPro, vouchers: vouchersPro, page: { brand: { name: "Your Club" } } });
// integrations: [...suite.integrations, emdash({ sandboxed: suite.sandboxed, plugins: suite.plugins })]
```

With `vouchers` the suite adds:

| Path | What it is |
| --- | --- |
| `<BuyVoucher />` | The buying form, for any page (`import BuyVoucher from "@semics-tech/emdash-events-suite/astro/BuyVoucher.astro"`). Props: `brand` (the card's heading), `returnTo` |
| `POST /_vouchers/buy` | Where the form posts: asks Vouchers for a Checkout Session and sends the buyer to Stripe |
| `/_vouchers/thanks` | Stripe's return page |
| `/_vouchers/v?c=<code>` | The voucher page linked from the emails: code, value, what is left, expiry, message, and **Print or save as PDF** (one A4 page) |
| `/_vouchers/setup` | Administrators: pick the activity vouchers from Events' catalogue, at Events' prices |
| `POST /_semics/stripe` | The site's one Stripe webhook endpoint |

The booking forms get a **Gift voucher code** field once Events Pro is paired with Vouchers (step 4). Without
`vouchers`, nothing about the site changes.

## 2. Stripe: one account, two keys, one webhook endpoint

Both plugins use the **same Stripe account**. Plugins cannot read each other's settings, so the keys are pasted
into each.

1. **Events Pro** keeps its secret key as before.
2. **Vouchers**: create a **restricted key** in the Stripe dashboard (Developers, API keys, Create restricted key)
   with **Checkout Sessions: Write** and **Refunds: Write**, nothing else. Paste it into Vouchers' settings,
   *Stripe secret key*. Vouchers can then do less than Events' key can.
3. **One webhook endpoint for the site**: `https://<your site>/_semics/stripe`, with the events
   `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and
   `checkout.session.async_payment_failed` (plus any Events Pro already asks for). Copy its signing secret
   (`whsec_…`) into **both** Events' and Vouchers' *Stripe webhook signing secret*. The endpoint reads each
   session's `metadata.plugin` and passes the delivery to that plugin, which checks the signature itself. A site
   already pointing Stripe at Events' own webhook can keep it for bookings, but vouchers are only issued through
   `/_semics/stripe`.

## 3. Settings (Vouchers, Plugins, Settings)

| Setting | Default | Notes |
| --- | --- | --- |
| Kinds of voucher sold | `money,activity` | Turn either off |
| Valid for (months) | 12 | For vouchers sold from now on; staff can extend one later |
| Preset amounts (pence) | `2500,5000,10000` | |
| Buyers may choose another amount | on, £10–£500 | `moneyCustomMin` / `moneyCustomMax`, in pence |
| Activity vouchers | none | Filled by `/_vouchers/setup` (below); one line each: `eventId, ticketTypeId, price, label` |
| Delivery options | `email-buyer,email-recipient,print` | Add `post` to collect a postal address (listed under "To post" for staff) |
| Buyers may pick the send day | on | The recipient's email goes out at 07:00 UTC that day |
| Currency | `GBP` | One currency per site |
| Turnstile site and secret key | none | Recommended for the buying form |
| Pro licence key | none | Your Events Pro or Suite key; not needed on local or preview hosts |

**Activity vouchers.** Sign in to the admin, open `/_vouchers/setup`, tick the ticket types to sell and press
**Save with Events' prices**. Each is sold at the price it has in Events then; after changing a price in Events,
save again (the page marks a price that has moved). An activity voucher pays for one place of its type at
whatever the price is on the day it is used. Prices never come from the buyer's browser.

## 4. Pairing

In Vouchers' admin, **Pairing**, create the pairing string (shown once) and paste it into Events' settings,
*Vouchers pairing string (Pro)* (`vouchersPairing`). From then on Events Pro shows the Gift voucher code field, and booking
holds, settles and credits run between the two. To change it, create a new one, paste it, settle any open holds
(admin, **Unsettled**), then revoke the old one.

## 5. How redeeming works

- The code is checked before anything is reserved: a mistyped, expired or spent code is refused on the form, so
  no booking is held and cancelled (and no "cancelled" email goes out).
- After reserving, Vouchers holds `min(balance, amount due)` (an activity voucher: one place of its type) in one
  guarded write, so two bookings can never both spend the same balance. Anything left is paid through Stripe.
- The booking page settles the hold: confirmed spends it; an abandoned checkout releases it (on the code's next
  use, or by staff); a cancelled or refunded booking puts the voucher part **back on the voucher**, not the card.

## 6. Accounting note

Vouchers' reports (outstanding liability, movements by month) keep **money** and **activity** vouchers apart and
**do not calculate VAT**. In the UK a money voucher is usually a *multi-purpose voucher* (VAT due when it is
spent) and an activity voucher usually a *single-purpose voucher* (VAT due when it is sold), but that depends on
the facts: confirm the treatment with your accountant before launch. This is not tax advice. Expired balances
show as breakage; refunds of a purchase are made in the Stripe dashboard after staff void an unused voucher.
