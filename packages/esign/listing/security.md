Report security problems to security@semics.dev, not in a public issue.

- Signing links are 256-bit random tokens, stored only as hashes. The signing page sends
  `Referrer-Policy: no-referrer` and posts the token rather than putting it in later URLs.
- Wrong links are limited per IP address. Opening a link records nothing: a mail scanner is not a signer.
- The signing and verify pages run under a strict Content-Security-Policy with no third-party scripts.
- The audit trail is hash-chained over salted commitments of personal data; the signed PDF's hash is stored
  and checked on download.
- Integration tokens are HMAC-signed with a secret derived per client and are single use.
- The only outside host is `challenges.cloudflare.com`, for the Pro self-serve form.

Details: https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/esign.md
