---
id: T128
title: "Licence Worker: owner issues a key without a sale"
phase: 6
package: suite
edition: pro
status: in-progress
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

- [ ] Tests first: no/short/wrong token → 404; bad plan or sites → 400; good request → a key the Pro gate accepts for those sites only; row is findable; email only when asked; migration if the schema needs `source`
- [ ] Script tested (argument parsing, token never echoed)
- [ ] R93 in BUILD-PLAN §12; Pro README support section documents it
- [ ] Deployed: `npx wrangler deploy` (and `wrangler d1 migrations apply semics-licences --remote` if a migration was added); `curl` without a token returns 404
- [ ] Meets the Definition of Done
