---
id: T124
title: "Product site at plugins.semics.co.uk (pricing, terms, privacy, refunds)"
phase: 6
package: suite
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T103, T121]
spec: [R88]
---

# T124 · Product site at plugins.semics.co.uk

## Definition

Paddle approves a checkout domain only when it sees a public site showing the products, prices, terms of
sale, a refund policy, a privacy policy and contact details (two clicks or fewer from the home page). The
site is `apps/site` in this repo: a static site built at test time (no framework needed, same approach as
`apps/docs` if that fits), served by a Cloudflare Worker with static assets on the custom domain
`plugins.semics.co.uk`. It links to the docs and the GitHub repo. Checkout buttons come later (they need an
approved domain and a Paddle client-side token); for now each paid plan says "Buy" links are coming and
gives the support address.

Seller: SEMICS LTD (take the legal name, company number and registered address from https://semics.co.uk,
its JSON-LD or footer; if a field is not published, leave a clearly marked TODO for the owner, never invent).
Paddle.com is the Merchant of Record and reseller: the terms and refund policy say so, in Paddle's
required form (check Paddle's current seller-terms / domain-review guidance on the web).

## Acceptance criteria

- [x] R88 recorded in `BUILD-PLAN.md` §12
- [x] Pages: home (what the plugins do, Free vs Pro), `/pricing` (Events Pro $79/yr, E-sign Pro $79/yr, Suite Pro $129/yr, Agency $349/yr — matching Pro `PADDLE_PRICES` and `docs/editions`), `/terms`, `/refunds` (at least 14 days, no-questions-asked within the window, via Paddle), `/privacy` (what the licence Worker stores: email, licensed sites, Paddle ids; Paddle as MoR; Cloudflare; retention; contact), `/contact` (support@semics.co.uk, company details). Every page footer links terms, refunds, privacy, contact
- [x] Tests first: a site test asserts every page exists, the footer links, the four prices, the support address, the Paddle MoR wording, no broken internal links, and no TODO left unless it is an owner TODO listed in the report
- [x] Accessible and responsive, light/dark, using the existing UI tokens where practical
- [x] Deployed: `wrangler deploy` with a custom-domain route for plugins.semics.co.uk; `curl` shows 200 for all six URLs
- [x] The legal text is marked in `docs/legal/brief.md` §13 as needing the lawyer's review before launch
- [x] Meets the Definition of Done

## Notes

- `apps/site`: `build.mjs` renders `pages.mjs` to `dist/` (six pages, a 404, `_headers` with a strict CSP);
  `wrangler.jsonc` is assets only, `workers_dev: false`, custom-domain route `plugins.semics.co.uk`.
  Deploy: `corepack pnpm@10.23.0 --filter site deploy`. Deployed 2026-10-26 (version
  005f1841-bd78-4b3c-ba7a-587ef09d6a55).
- Tests: `apps/site/tests/site.test.mjs` (vitest, 52 tests, under the test lock). A `pnpm verify` gate runs it.
- Company facts are all published at semics.co.uk (SEMICS LTD, 12871299, Slowley Hall, Tamworth Road, Coventry,
  CV7 8EB): no TODOs on the site.
- Owner follow-ups: (1) the GitHub repo `semics-uk/emdash-plugins` answers 404 publicly, so the site's Docs and
  GitHub links 404 until it is public; (2) the privacy retention periods (licence records 6 years after the
  licence ends, support email 2 years) are proposed defaults to confirm; (3) the Pro LICENSE the terms refer to is
  still a placeholder (D6); (4) the terms, refunds and privacy text await the lawyer (brief §13, question 17);
  (5) make sure support@semics.co.uk receives mail.
- `docs/editions` (apps/docs/pages/editions.md) now states the four prices and links the pricing page.

