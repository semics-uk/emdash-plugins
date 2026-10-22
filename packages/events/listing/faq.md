**Why is there no booking form after installing from the registry?** The registry installs the core only.
Add the npm package `@semics-tech/emdash-events` for the form and pages.

**Bookings are limited to 10 in 10 minutes for everyone.** EmDash does not know visitors' IP addresses. Off
Cloudflare, set `trustedProxyHeaders` to the header your proxy overwrites, and only that one.

**Emails are slow.** The plugin sends two emails a minute, rendered from current data.

**Nothing happens on schedule.** Open the events list or a plugin admin page once after deploying: the plugin
then schedules its own jobs.

**Can I sell paid tickets?** With Events Pro and Stripe.

**Does it work in my language?** The visitor pages ship in English and Arabic, and you can add more. Emails,
calendar files and the admin are English.

More: https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/faq.md
