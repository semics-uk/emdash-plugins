# Paid tickets (Events Pro)

Paid tickets need Events Pro and a Stripe account. Buyers pay on Stripe Checkout; the site never sees card
details. The Free edition never contacts Stripe, and its manifest does not even allow `api.stripe.com`.

## Set up Stripe

1. **API key.** In Stripe, create a secret key, or better a restricted key with write access to Checkout
   Sessions and Refunds. That access also covers reading a Checkout Session, which the plugin needs to check
   on late payments. Paste it into the Events setting **Stripe secret key** (`stripeSecretKey`).
2. **Webhook endpoint.** In Stripe, add an endpoint at:

   `https://<your site>/_emdash/api/plugins/<plugin id>/webhooks/stripe`

   The plugin id is `semics-events` for an npm install, or the `r_…` id a registry install gave it.
3. **Events to send.** Subscribe the endpoint to exactly these four:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
4. **Signing secret.** Copy the endpoint's signing secret (`whsec_…`) into **Stripe webhook signing secret**
   (`stripeWebhookSecret`).

Without the webhook signing secret, the plugin answers every delivery with an error (503) and no paid booking
is ever confirmed. Stripe keeps retrying, so fixing the secret within three days settles the payments made
meanwhile.

Both keys are secret settings, so the server needs `EMDASH_ENCRYPTION_KEY` ([Configure](configure.md)).

## How a paid booking works

1. The buyer books; the seats are held for **Hold time, paid tickets** (default 35 minutes, because Stripe's
   Checkout needs at least 30).
2. The buyer pays on Stripe and comes back to `/booking`. The page waits for the payment to be confirmed and
   checks again a few times; without JavaScript it has a "Check again" button.
3. Stripe's webhook confirms the booking and the confirmation email is sent.

If the buyer leaves, `/booking` offers **Pay now** while the hold lasts.

## Refunds

- **Cancelling**: a buyer who cancels a paid booking before the cutoff is refunded in full.
- **Admin refund**: the Bookings page can refund a booking in full.
- **Late payment**: if a payment arrives after the hold expired, the plugin books the seats again if they are
  still free. If they are not, it refunds the payment.
- **Second payment**: a second payment for the same booking is refunded.

Buyers get an email from the plugin about each of these refunds.

## Payments of the wrong amount

Every payment's amount and currency are compared with the booking's total (after any promo code) before
anything is confirmed. If they differ, including a payment with no amount, the plugin does not confirm the
booking: the payment is refunded in full automatically, and a warning goes to the site's logs. The booking
stays as it was: still payable with "Pay now" if its hold has not lapsed.

The buyer gets no plugin email about this refund: the plugin's refund email would name the booking's total,
not the amount that was charged. The buyer gets only Stripe's refund receipt, which names the right amount.
Such a payment can only come from a Checkout Session made on your Stripe account outside the plugin.

Where to look:

- **The site's logs**: the plugin writes a warning, `stripe payment amount differs from the booking; refunding`,
  with the expected and the paid amount and currency. On Cloudflare Workers look in the Worker's logs; on Node,
  in the server's output.
- **The Stripe dashboard**: the refund carries metadata `reason: amount_mismatch` with the booking id and the
  Checkout Session id.

## When the webhook was missed

Every 10 minutes, the plugin asks Stripe about any payment still pending an hour after its Checkout Session
expired, one or two at a time, and settles it as the webhook would have. So a misconfigured endpoint is
caught up once you fix it.

## Switching back to Free

The Free edition answers the webhook endpoint with an error (503). Stripe then keeps retrying deliveries for
up to three days. Switch back to Pro within that window and every payment made meanwhile is settled:
confirmed, booked again or refunded. After longer, the 10-minute check above catches them up.
