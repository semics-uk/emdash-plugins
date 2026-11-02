---
id: T146
title: "Publish the Pro licence, align its refund clause, show the first-year discount"
phase: 7
package: site
edition: free
status: done
model: opus-5.5
size: S
depends_on: []
spec: []
---

# T146: Publish the Pro licence, align its refund clause, show the first-year discount

Status: done (owner: orchestrator, from legal research pass 3, `c5b3ea4`)

## Why
Legal research pass 3 (`docs/legal/research.md`) found:
- the refunds page says a refunded buyer no longer has a licence, but Pro LICENSE §4 and §7 keep the perpetual right;
- the Pro licence is only in the npm package, not visible before payment;
- the shipped LICENSE carries a "Draft… not by a lawyer" note;
- the D5 first-year discount is not on the pricing page.

## Decisions
- The refunds page wins: a refund ends the licence for the refunded purchase. Refunding a renewal keeps the
  versions released during the years paid for. Pro LICENSE §4 and §7 change to match.
- The licence is published at https://plugins.semics.co.uk/licence and linked from pricing and terms (and so
  from checkout once buy links exist). Its text is `apps/site/pro-licence.txt`, a copy of the Pro repo's
  `packages/*/LICENSE`; change both together.
- The draft note leaves the shipped file. The lawyer review is still tracked by brief §13 Q17 and the
  `review: true` page comment.
- The discount wording is shown now; the owner sets the matching Paddle discount (T072: discounts live in Paddle).

## Done when
- [x] Tests in `apps/site/tests/site.test.mjs` (T146 blocks) pass.
- [x] Pro `packages/esign-pro/LICENSE` and `packages/events-pro/LICENSE` match `apps/site/pro-licence.txt`.
- [x] Brief fixes from pass 3: issue number, Q17 line in §14, §12 multi-signer review, hostname vs site.

## Notes
- The site is not deployed by CI: the owner runs `pnpm --filter site deploy` to publish `/licence` and the new
  pricing and refunds text.
- The owner must set the D5 discount (40% off the first year, first 100 customers) in Paddle before checkout opens.
- Pro LICENSE change is in the Pro repo with a changeset, so it ships in the next Pro release.
- Paddle check (2026-11-02, public help pages, not confirmed with Paddle):
  - UK and EU (all 27 states) buyers of subscriptions of 180 days or more get Paddle's auto-renewal reminder, 7 or 30
    days before renewal; it cannot be switched off. Our plans are yearly, so every renewal, including the first
    full-price one after the D5 discount, gets a reminder.
  - Subscription emails carry a cancel / manage-subscription link to Paddle's customer portal; cancelling keeps the
    licence to the end of the paid year.
  - Our 14-day refund on every renewal covers the UK renewal cooling-off.
  - Not found: anything on the EU withdrawal function (Directive 2023/2673, in force 19 June 2026) or on the UK DMCC
    rules by name. Ask Paddle support whether the portal meets the withdrawal-function rules; until answered, the
    refunds page (email, or paddle.net) is our withdrawal route.
  - Sources: paddle.com/help/manage/your-customers/enhanced-billing-notifications-location-list,
    .../which-emails-will-customers-receive-on-paddle-billing, developer.paddle.com/build/subscriptions/cancel-subscriptions/
- 2026-11-02: site deployed (Worker version 67dd84cb); `/licence`, pricing and refunds checked live.
- 2026-11-02: Paddle discount created (live account): 40% off, 1 payment (the first year), 100 redemptions,
  code `LAUNCH40`, all products. The checkout must apply it (code or discount id) once buy links exist.
- Paddle has no in-dashboard chat; the question on the EU withdrawal function and UK DMCC rules is drafted in Gmail
  to sellers@paddle.com, waiting for the owner's OK to send.
