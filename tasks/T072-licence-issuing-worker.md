---
id: T072
title: "Licence issuing Worker"
phase: 4
package: licence-worker
edition: pro
status: review
model: opus-5.5
size: M
depends_on: [T070]
spec: [Management plan: How a sale works]
---

# T072 · Licence issuing Worker

## Definition

A Cloudflare Worker that verifies Paddle webhooks, signs licence keys, issues registry tokens and handles renewals, cancellations and refunds; runs locally with Miniflare and recorded webhook fixtures.

## Model

**Opus 5.5**: Payments-adjacent security.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Valid webhook issues a key that `licence.ts` accepts
- [x] Bad signature rejected
- [x] Renewal extends `updatesUntil`
- [x] Refund revokes the registry token but never disables a site

## Implementation (green, then refactor)

- `apps/licence-worker/`

## Acceptance criteria

- [x] Signing key only from secrets
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter licence-worker verify
```

## Notes

- **Where it lives.** Proprietary, so only in the Pro repo (R40): `emdash-plugins-pro/packages/licence-worker`
  (`@semics-tech/licence-worker`, branch `pro-agent-t072`), not `apps/licence-worker/` as written above;
  the Pro workspace is `packages/*` only. `pnpm --filter licence-worker verify` works (scope omitted), and
  the Pro repo's `pnpm verify` runs it (typecheck, node + workerd tests, `wrangler deploy --dry-run`
  bundle, offline). Nothing was deployed and nothing in this public repo changed except this file.
- **Paddle signature scheme** (Paddle Billing docs "Verify webhook signatures", the same check as
  `@paddle/paddle-node-sdk` `Webhooks.unmarshal`): `Paddle-Signature: ts=<unix s>;h1=<hex>`, where
  `h1 = HMAC-SHA256(endpoint secret key, "<ts>:<raw body>")`; any of several `h1` accepted (secret
  rotation); timestamp tolerance 5 minutes (the SDK default is 5 s). Tested against an independent
  `node:crypto` HMAC. No live Paddle account: the fixtures are modelled on Paddle's documented
  payloads, not captured from a real account, and are signed at test time with a throwaway secret.
- **Behaviour.** First `transaction.completed` -> key for the checkout's `custom_data.sites`
  (normalised, local/preview hosts refused, max 1 site, 10 for agency) + registry token, emailed via
  Resend to the buyer's email from Paddle's customer API (webhooks carry only `customer_id`). No valid
  hostnames -> `needs_sites`, email asks for them. Renewal (later transaction on the subscription) ->
  `updatesUntil` = new period end (never backwards), new key emailed, token expiry extended.
  Approved full refund / chargeback (`adjustment.created|updated`) -> `refunded`, token revoked;
  `subscription.canceled` -> `cancelled`, token revoked; neither ever gets another key. Offline keys
  can't be remotely disabled (§13 "Honest limit"): revocation = no new keys, no registry access, and
  a `refunded` record support uses to refuse help; the site keeps working (tested).
- **Idempotency** on Paddle `event_id` (D1 claim row; a failed delivery deletes its claim and
  returns 500 so Paddle's retry reprocesses it; a duplicate gets 200 `duplicate`).
- **Secrets.** The private key exists only as the `LICENCE_SIGNING_KEY` Worker secret; each key is
  verified with `LICENCE_PUBLIC_KEY` and `createLicenceVerifier` before it is emailed (a mismatched
  pair returns 500 and sends nothing). Tests generate key pairs per run; a test scans the package for
  key material and checks no secret is a `vars` entry. `scripts/keypair.mjs` is the owner's one-off
  pair maker: public half to `licence/public-key.txt`, private half to stdout only, for
  `| wrangler secret put LICENCE_SIGNING_KEY`.
- **Registry tokens are a stub seam** (`RegistryTokens` in `src/registry-tokens.ts`): §13 ships Pro as
  private npm packages installed with an access token, moving to the EmDash registry when it supports
  paid plugins. npm only honours tokens npm issues and the registry has no paid-plugin support, so the
  Worker mints its own `semreg_...` tokens (SHA-256 hash stored, expiry = `updatesUntil`, revocable) and
  nothing consumes them yet; the owner grants npm access by hand until a registry proxy or the EmDash
  registry calls `check`.
- **Decisions.** Agency = Suite (both products) for up to 10 hostnames (D5 says only "agency (10
  sites) $349"). The Worker maps Paddle price ids to plans (`PADDLE_PRICES` var) and never checks
  amounts, so the first-100 discount and currencies live in Paddle. Partial refunds leave the licence
  alone. The cited spec "Management plan: How a sale works" isn't in either repo; §13, D5 and D6 were used.
- **Owner setup (before deploying):** run the key pair script and commit `licence/public-key.txt`
  (also set as the `LICENCE_PUBLIC_KEY` var); create the Paddle products and yearly prices (Events
  Pro 79, E-sign Pro 79, Suite Pro 129, Agency 349) and put the price ids in `PADDLE_PRICES`; make the
  checkout send `customData: { sites: [...] }`; add a notification destination for
  `transaction.completed`, `subscription.canceled`, `adjustment.created`, `adjustment.updated` pointing
  at `/paddle/webhook`; `wrangler d1 create semics-licences` + migrations; secrets
  `PADDLE_WEBHOOK_SECRET`, `PADDLE_API_KEY` (customer read), `MAIL_API_KEY` (Resend, verified domain for
  `MAIL_FROM`); set `MAIL_FROM`/`SUPPORT_EMAIL`.
- **Follow-ups:** a support/admin way to issue the key for a `needs_sites` sale or change a licence's
  hostnames (today: by hand); the registry consumer for tokens; a cron to alert on events stuck
  `processing`.
