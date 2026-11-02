# T146: Publish the Pro licence, align its refund clause, show the first-year discount

Status: in progress (owner: orchestrator, from legal research pass 3, `c5b3ea4`)

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
- [ ] Tests in `apps/site/tests/site.test.mjs` (T146 blocks) pass.
- [ ] Pro `packages/esign-pro/LICENSE` and `packages/events-pro/LICENSE` match `apps/site/pro-licence.txt`.
- [ ] Brief fixes from pass 3: issue number, Q17 line in §14, §12 multi-signer review, hostname vs site.
