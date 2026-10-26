---
id: T126
title: "Site and Pro licence fixes from the legal research (question 17)"
phase: 6
package: suite
edition: free
status: in-progress
model: opus-5.5
size: M
depends_on: [T124]
spec: [R88, R89, R90, R91]
---

# T126 · Site and Pro licence fixes from the legal research (question 17)

## Definition

The AI research pass over the legal brief (`docs/legal/research.md` Q17, commit `d434be9`, not legal advice) found
that the product site and the Pro licence do not hold together: the Pro `LICENSE` the terms rely on is a placeholder
granting nothing; BUILD-PLAN D6 says a 30-day refund while the site says 14 days; the site says Pro "stops taking
new work" when a licence ends, but issued keys keep verifying offline; the privacy page calls Paddle a processor,
lacks legal bases for logs and support email and the rights to portability and to object, and promises a 6-year
deletion the licence Worker never does; prices are shown "before tax" without the total-price note (DMCCA s.230).

## Acceptance criteria

- [ ] Pro licence (Pro repo, `packages/esign-pro/LICENSE`, `packages/events-pro/LICENSE`): a real commercial
      licence from SEMICS LTD matching D6 (one key per production hostname, local and preview hosts free, a year of
      updates, perpetual use of versions released in the term, modification for own use, no redistribution),
      marked as needing the lawyer's review; a Pro test keeps the two files identical and free of the placeholder
- [ ] Refund period decided (R89: 14 days) and consistent across the site, BUILD-PLAN D6/R88 and the docs
- [ ] The site's licence-end and refund sentences describe what the code does (offline keys keep working with the
      versions released in the term; no new keys; newer versions need a renewed key)
- [ ] Privacy: Paddle as an independent controller; legal bases for website logs and support email (legitimate
      interests); rights to portability and to object; retention matching the licence Worker
- [ ] Licence Worker: the cron deletes licence records (and their registry tokens) 6 years after the licence ends,
      and Paddle event records after 1 year (R91), test first
- [ ] Prices: the pricing page says the total including tax is shown at checkout before payment
- [ ] `docs/legal/brief.md` question 17 mentions the licence text, the refund decision and the 2027 UK subscription
      rules
- [ ] Tests first in `apps/site/tests/site.test.mjs` for each site change
- [ ] Meets the Definition of Done

## Notes

- Do not deploy the site or publish anything: the owner deploys (`pnpm --filter site deploy`) and the Pro licence
  ships with the next Pro release.
