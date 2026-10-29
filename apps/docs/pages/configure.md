# Configure

Settings live on each plugin's settings screen in the EmDash admin. Secret settings are stored encrypted.
This page covers what you set once per site.

## Secrets need `EMDASH_ENCRYPTION_KEY`

EmDash encrypts every secret setting with `EMDASH_ENCRYPTION_KEY`. Without it, saving a secret fails.
Generate the key with `npx emdash secrets generate` ([Install](install.md#5-set-the-secrets-key-and-site-url))
and keep a copy somewhere safe.

The sandboxed cores cannot read the server's environment, so they cannot warn you in advance. E-sign shows
a banner after a secret fails to save, or when a stored secret cannot be read. If you change the key, every
secret saved under the old key becomes unreadable: enter them again.

## The site's public address

Set `siteUrl` in the `emdash()` config (or `EMDASH_SITE_URL` in the environment) to the address visitors
type, such as `https://events.example.com`.

- Emails are sent by scheduled jobs, which have no request to take the address from. Events builds the
  links in its emails from it. E-sign queues no invitation or completion email without it: sending an
  envelope then says the site URL is missing.
- `security.allowedDomains` gives `Astro.url` the public host. EmDash adds the host of a `siteUrl` set in
  the config to Astro's `security.allowedDomains` for you. If you set the address only through the
  environment, add it yourself: `security: { allowedDomains: [{ hostname: "events.example.com" }] }`.
  Without it, Astro builds `Astro.url` from `localhost`, and redirects and links on the plugin pages can
  point at the wrong host.

## Cross-site form posts

EmDash turns off Astro's `security.checkOrigin`. The plugins do not rely on it: the Events forms (checkout,
promo code, waitlist, cancel, booking link) and the E-sign pages (signing, verify, self-serve start) check the
Origin themselves. A post from another site gets `403`. They use the browser's `Sec-Fetch-Site` header, or
compare `Origin` with the `Host` the browser sent.

## Client IP addresses and proxies

Some limits count requests per visitor IP address: the Events reserve limit (10 bookings per IP in 10
minutes), the waitlist join limit (5 per IP in 10 minutes), the E-sign signing-link limit (20 wrong links per
IP in 10 minutes) and `/verify` (20 checks per IP in 10 minutes). E-sign also records the signer's IP address
in the audit trail.

The Events and E-sign UI forwards the visitor's client-IP headers as sent to the plugin routes. EmDash then
decides which header to believe:

- **On Cloudflare Workers** EmDash reads `CF-Connecting-IP`, which Cloudflare sets. Do nothing.
- **Elsewhere**, EmDash believes only the headers you list in `trustedProxyHeaders` (in the `emdash()` config)
  or `EMDASH_TRUSTED_PROXY_HEADERS` (comma-separated).

Trust a header only when a proxy in front of the site overwrites it. If you trust `x-forwarded-for` and
nothing in front of the site replaces it, any visitor can send their own value, pick any IP address and
step around the per-IP reserve limit. They can also write a false IP into a signing record.

If no header is trusted and the site is not on Cloudflare, EmDash knows no visitor's IP. Every visitor then
shares one bucket: the whole site can take only 10 bookings in 10 minutes. So behind a reverse proxy (nginx,
Caddy, a load balancer), set the one header that proxy overwrites:

```sh
EMDASH_TRUSTED_PROXY_HEADERS=x-real-ip
```

## Page caching

Do not put the plugin pages, or an event page with a booking form, in a cache shared between visitors (a CDN
or reverse-proxy page cache). Without JavaScript, the booking form carries its order key in the
server-rendered page. Resubmitting an order with that key, the same email and the same tickets returns the
booking with a fresh access token while it is still on hold (a confirmed booking keeps its emailed one). A
shared cached copy would hand every visitor the same key. The plugin pages already send
`Cache-Control: no-store`; make sure your own event pages that hold a `BookingWidget` are not publicly cached
either.

## Email

The plugins send email through EmDash. EmDash needs an email provider plugin: install one, activate it and
choose it in **Settings > Email**. Without one, EmDash reports "No email provider is configured" and no email
leaves the site. Under `astro dev`, EmDash's dev console provider prints emails to the terminal.

Both plugins queue email in their own outbox and a job sends it every minute:

- **Events** sends at most **two emails a minute**. Each email is rendered from fresh data when it is sent,
  which costs most of a job's budget. A large broadcast or a burst of bookings is sent over several minutes.
- **E-sign** sends up to six a minute.
- A failed send is retried up to five times, waiting from one minute up to an hour between tries.

The **Email sender name** (Events) and **Sender name** (E-sign) settings set the name on the emails. The
address comes from your email provider.

## Cloudflare Turnstile

Turnstile is Cloudflare's bot check. Create a widget at Cloudflare and copy its two keys.

- **Events**: set **Turnstile site key** and **Turnstile secret key**. The booking form and the waitlist form
  then show the check. Without a secret, checkout runs with no bot check: the Setup check page says
  "Not set up". (Each buyer's IP address is stored only as a salted hash either way: without a Turnstile
  secret the plugin makes a random salt of its own on the first booking.)
- **E-sign**: the keys are used only by the Pro self-serve form, which refuses to show without them. The
  signing page never uses Turnstile: the secret signing link is the credential.

Both plugins list `challenges.cloudflare.com` as their only outside host.

## Events settings

| Setting | Default | What it does |
| --- | --- | --- |
| Events collection | `events` | Collection that holds your events |
| Start field, End field, Timezone field, Venue field | `starts_at`, `ends_at`, `timezone`, `venue` | Field names in that collection |
| Hold time, free tickets (minutes) | 15 (5-60) | How long seats are held during a free checkout |
| Hold time, paid tickets (minutes) | 35 (30-60) | The same for a paid checkout (Pro). Stripe needs at least 30 |
| Maximum total hold (minutes) | 60 (15-120) | Each checkout step extends the hold, never past this |
| Self-service cancel cutoff (hours before start) | 24 (0-720) | Buyers can cancel a confirmed booking until then |
| Default currency | `GBP` | ISO 4217 code for new events |
| Turnstile site key, Turnstile secret key | none | See above |
| E-sign pairing string | none | Links Events to E-sign for waivers ([Waivers](waivers.md)) |
| Licence key, Stripe secret key, Stripe webhook signing secret (Pro) | none | Used only by Events Pro; Free ignores them |
| Keep booking data (days) | 365 (at least 30) | Personal data of past events is erased after this ([Data and retention](privacy.md)) |
| Email sender name | site name | Name on booking emails |
| Admin notification emails | none | Up to 5 addresses told about bookings ([Approving bookings](events.md#approving-bookings)) |
| Notify admins about | booking requests | Requests that need approval, all bookings, or nothing |

## E-sign settings

| Setting | Default | What it does |
| --- | --- | --- |
| Sender name | none | Name on signing emails |
| Consent version | `1` | Recorded with every signature. Raise it when you change the wording |
| Consent wording | "I agree to use electronic records and an electronic signature for this document." | Shown to signers before they sign |
| Envelope expiry (days) | 30 (1-365) | An unsigned envelope closes this long after it was sent |
| Reminder cadence (days) | 3 (1-30) | Pro: automatic reminders |
| Require email code by default | off | Pro: one-time code before signing |
| Require email code for contract templates | on | Pro |
| Keep personal data (months) | 12 (1-120) | See [Data and retention](privacy.md) |
| Keep signed records (years) | 7 (1-50) | See [Data and retention](privacy.md) |
| Turnstile site key, Turnstile secret key | none | Pro self-serve form only |
| Integration master key | none | Derives each integration client's secret. Shown once |
| Licence key (Pro) | none | Used only by E-sign Pro |

The secret settings marked Pro exist in the Free manifests too. That way a site that switches from Pro back
to Free can still read its settings.
