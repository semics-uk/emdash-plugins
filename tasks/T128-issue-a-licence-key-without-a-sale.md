---
id: T128
title: "Licence Worker: owner issues a key without a sale"
phase: 6
package: suite
edition: pro
status: blocked
model: opus-5.5
size: S
depends_on: [T106, T126]
spec: [R93]
---

# T128 · Licence Worker: owner issues a key without a sale

## Definition

The owner wants Pro on their own sites (and for comps or support) before and besides Paddle sales. Add a
support route to the Pro licence Worker (`packages/licence-worker/src/admin.ts`, bearer `ADMIN_TOKEN`, 404
without it like the others): `POST /admin/licences/issue` with `{ plan, sites: [hostname...], email?,
updatesUntil? }` (plan one of the `PADDLE_PRICES` plans; default updates 1 year; sites validated and
counted per plan exactly as a sale does). It signs a key with the same issuer, stores a licence row marked
`source: "manual"` (no Paddle ids) so `/admin/licences` finds it, and returns the key; it emails it only
when `email` is given. Plus `scripts/issue-licence.mjs` in the Pro repo: `node scripts/issue-licence.mjs
--plan suite --site example.com [--site …] [--email …]`, reading the admin token from the `ADMIN_TOKEN`
env var or a file path in `ADMIN_TOKEN_FILE`, never printing the token, printing the key. Record R93.

## Acceptance criteria

- [x] Tests first: no/short/wrong token → 404; bad plan or sites → 400; good request → a key the Pro gate accepts for those sites only; row is findable; email only when asked; migration if the schema needs `source`
- [x] Script tested (argument parsing, token never echoed)
- [x] R93 in BUILD-PLAN §12; Pro README support section documents it
- [ ] Deployed: `npx wrangler deploy` (and `wrangler d1 migrations apply semics-licences --remote` if a migration was added); `curl` without a token returns 404
- [x] Meets the Definition of Done

## Notes

- Pro main 478c8df (test 87c04f7, feat 0e49075, docs 478c8df). Licence-worker suite 78/78, `node --test
  scripts/*.test.mjs` 51/51, typecheck and `wrangler deploy --dry-run` clean.
- Decided: a missing or wrong bearer token now gets 404 on every admin route (was 401), as the criterion and
  the curl check ask; the T106 auth test was updated. A failed mail still returns the key (`emailed: false`).
  Manual licences get no registry token and use their own `lic_` id in the transaction/customer columns.
- **Blocked on deploy (2026-10-29):** wrangler here is logged in (OAuth, oliver@semics.co.uk) to account
  48311ca3…, which does not hold the Worker; it lives in account 4426cce4… (code 10007 / 10000). Nothing was
  deployed and no migration applied; production still answers 401 on `/admin/licences` without a token.
  Owner, from `packages/licence-worker` in the Pro repo after `npx wrangler login` with the semics account,
  **migration first** (the new code writes `licences.source`, so a sale would fail against the old schema):
  1. `npx wrangler d1 migrations apply semics-licences --remote`
  2. `npx wrangler deploy`
  3. `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://licences.semics.co.uk/admin/licences/issue` → 404
  Then issue a key: `ADMIN_TOKEN_FILE=~/.semics-admin-token node scripts/issue-licence.mjs --plan suite --site example.com`
  (from the Pro repo root; the file holds the Worker's `ADMIN_TOKEN` secret).
