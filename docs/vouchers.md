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

The booking forms get a **Gift voucher code** field once Events Pro is paired with Vouchers (step 4), with a
"Have a gift voucher?" link above the form that jumps to it. Without `vouchers`, nothing about the site changes.

### Book with this voucher (T171, optional)

For a site that takes bookings online, wrap the core and turn on `book`:

```js
eventsSuite({ events: eventsPro, vouchers: { core: vouchersPro, book: true } }); // or book: { listPath: "/whats-on" }
```

The voucher page then shows **Book with this voucher**. An activity voucher goes to its event's page
(`page.eventPath`, default `/events/{slug}`) with its ticket type chosen, at the booking form; a money voucher goes
to the page listing your activities (`listPath`, default `/events`). The code is filled in for the buyer. The button
is hidden (and the page says to enter the code when booking) when the voucher has nothing left, or when Events does
not list the activity's event on sale with a slug, for example an activity line typed with ids Events does not
know. Leave `book` off where staff redeem vouchers by hand.

To put the same link in the voucher emails, also tick Vouchers' setting **Add a Book with this voucher link to
voucher emails** (`emailBookLink`, off by default).

How the code gets there: voucher/1 §8 allows a code in one URL only, the voucher page's own. The button is that page
with `&book=1`; it sets a 30-minute HttpOnly cookie (`semics_voucher`, SameSite=Lax) and redirects (303, no referrer,
not cached) to the form, which fills the field from the cookie on the server. No booking URL carries the code, and no
JavaScript is needed. A form that filled in a code sends `Cache-Control: private, no-store` where it still can; do not
put event pages behind a shared cache that ignores cookies. The booking page clears the cookie once a booking has used
a voucher.

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

Sign in to the admin, open `/_events/pair` and press **Pair with Vouchers on this site** (the Gift vouchers
section). The page asks Vouchers for a new pairing and stores it in Events' encrypted *Vouchers pairing string (Pro)*
(`vouchersPairing`) on the server: there is nothing to copy, and the string never reaches the browser. From then on
Events Pro shows the Gift voucher code field, and booking holds, settles and credits run between the two.

The section says whether Events is paired, not paired, or holds a pairing for a client that is no longer Vouchers'
active one (Vouchers was paired again or the client was revoked); press the button again to fix it. If a string was
pasted by hand and Events cannot use it, it says why (a space or line break around it, an E-sign string, or not a
whole string), without showing it.

By hand, as before: in Vouchers' admin, **Pairing**, create the pairing string (shown once) and paste it, exactly
and with nothing around it, into Events' *Vouchers pairing string (Pro)*. Either way, an older client is left
active for bookings that already used it: settle any open holds (admin, **Unsettled**), then revoke it.

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
