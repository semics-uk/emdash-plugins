# Troubleshooting

## No emails arrive

- Check that EmDash has an email provider: install and activate an email provider plugin, then choose it in
  **Settings > Email**. Without one, EmDash reports "No email provider is configured".
- Check that the site URL is set (`siteUrl` or `EMDASH_SITE_URL`). E-sign queues no email without it, and
  Events' links would have no host.
- Check that scheduled jobs run (below): emails are sent by a job every minute.

## Emails arrive slowly

Events sends two emails a minute; E-sign up to six. A burst of bookings or a broadcast is sent over several
minutes. A failed send is retried up to five times, waiting longer each time.

## Holds are never released, or nothing is sent

The plugins' work runs in scheduled jobs. EmDash 1.2 does not run a plugin's start-up hook for a core listed
in `sandboxed`, so the plugins schedule their own jobs the first time one of their public pages or admin pages
loads. Open the events list or a plugin admin page once after each deploy.

EmDash must also run its scheduler: on Cloudflare, the site's Cron Trigger (every minute). `npx emdash doctor`
checks the scheduler wiring.

## "Too many bookings from this connection" for everyone

EmDash does not know the visitors' IP addresses, so they all share one limit of 10 bookings in 10 minutes. Off
Cloudflare, set `trustedProxyHeaders` to the header your proxy overwrites
([Configure](configure.md#client-ip-addresses-and-proxies)).

## Saving a secret setting fails

Set `EMDASH_ENCRYPTION_KEY` in the server's environment and restart. If secrets saved earlier now fail to
read, the key changed: restore the old one, or enter the secrets again.

## "The security check did not pass"

The Turnstile keys do not match, or your site's domain is not on the Turnstile widget at Cloudflare. Check
both keys in the Events settings.

## The booking form says "This event is not taking bookings"

The event has no booking settings yet (choose **Enable booking** in the panel), its sales status is not
`on_sale`, or the entry is a draft, unpublished or has no start date.

## The "Tickets & booking" panel is missing

The panel shows only on entries of a collection called `events`. Use the **Event editor** admin page for
another collection ([Events guide](events.md#the-editor-panel-and-other-collections)).

## An event cannot be moved to the bin

It has live bookings. Cancel them first, or unpublish the event to take it off sale.

## Links in emails point at the wrong host

Set `siteUrl` (or `EMDASH_SITE_URL`) to the public address.

## A form answers "Cross-site form submissions are not allowed."

The post came from another site, or a proxy changed the `Host` header between the browser and the site.
Pass the browser's `Host` through, and set `siteUrl` ([Configure](configure.md#the-sites-public-address)).

## The plugin pages say a route was not found

The UI is calling the wrong plugin id. A core installed from the registry has an `r_…` id: pass it to the
integration or the suite ([Install](install.md#3-cores-installed-from-the-registry)).

## The signed PDF is not ready

A job builds the PDF just after signing, usually within a minute or two. The signed-copy page says it is
pending until then.

## A paid booking stays pending (Events Pro)

Check the Stripe webhook endpoint, its four events and the signing secret ([Paid tickets](payments.md)). A
payment still pending an hour after its Checkout Session expired is checked with Stripe every 10 minutes.

## "Signing is not set up on this site." on a waiver link

Events was not told E-sign's plugin id. Install both through the suite ([Install](install.md)), and paste the
pairing string into Events ([Waivers](waivers.md)).

## The check-in screen says it needs Events Pro

It does. On Free, check people in on the **Attendees** page.
