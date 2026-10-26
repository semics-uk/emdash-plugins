---
id: T124
title: "Product site at plugins.semics.co.uk (pricing, terms, privacy, refunds)"
phase: 6
package: suite
edition: free
status: in-progress
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

- [ ] R88 recorded in `BUILD-PLAN.md` §12
- [ ] Pages: home (what the plugins do, Free vs Pro), `/pricing` (Events Pro $79/yr, E-sign Pro $79/yr, Suite Pro $129/yr, Agency $349/yr — matching Pro `PADDLE_PRICES` and `docs/editions`), `/terms`, `/refunds` (at least 14 days, no-questions-asked within the window, via Paddle), `/privacy` (what the licence Worker stores: email, licensed sites, Paddle ids; Paddle as MoR; Cloudflare; retention; contact), `/contact` (support@semics.co.uk, company details). Every page footer links terms, refunds, privacy, contact
- [ ] Tests first: a site test asserts every page exists, the footer links, the four prices, the support address, the Paddle MoR wording, no broken internal links, and no TODO left unless it is an owner TODO listed in the report
- [ ] Accessible and responsive, light/dark, using the existing UI tokens where practical
- [ ] Deployed: `wrangler deploy` with a custom-domain route for plugins.semics.co.uk; `curl` shows 200 for all six URLs
- [ ] The legal text is marked in `docs/legal/brief.md` §13 as needing the lawyer's review before launch
- [ ] Meets the Definition of Done
