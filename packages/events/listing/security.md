Report security problems to security@semics.dev, not in a public issue.

- Booking access tokens are random, stored only as hashes, and never put in URLs. Emailed links carry a
  one-time code that is used only when the visitor presses a button, so mail scanners cannot use it up.
- Every form the plugin adds refuses posts from other sites. Refusals never reveal another buyer's data.
- Seat counts are checked as they are written, so concurrent bookings cannot oversell.
- Turnstile protects checkout and the waitlist. Bookings are limited per visitor IP address.
- The only outside host is `challenges.cloudflare.com`. Personal data is erased after the retention period.

Details: https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/configure.md
