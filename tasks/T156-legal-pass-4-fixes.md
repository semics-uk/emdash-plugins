# T156: Fix what legal research pass 4 found in the T146 changes

Status: in progress (owner: orchestrator; owner approved the fixes and UK VAT-inclusive pricing, 2026-11-07)

## Why
`docs/legal/research.md` pass 4 (`87592d9`) found licence §4/§7 contradicting themselves on a renewal refund, the licence
Worker closing the whole licence on one, ex-VAT and unpriced offers on /pricing, "email to buy" conflicting with Paddle as
seller, `LAUNCH40` not on the page, nothing visible saying the licence is unreviewed, and small wording gaps.

## Decisions
- Prices stay in USD, with the price including UK VAT at 20% shown as prominently as the price before tax. Business-only
  sales were rejected because they would turn consumers away.
- A refund of a first purchase ends the licence. A refund of a renewal ends only that year: the Worker rolls `updatesUntil`
  back a year, emails a key for the kept versions and closes the licence (`cancelled`), so no further keys are issued.
- A chargeback is treated as a refund; a partial refund ends nothing. Refunding an older renewal is left to support.
- No payment by email. Every sale goes through Paddle.
- /licence says visibly that the text is under legal review.

## Done when
- [ ] Worker tests (`T156` in the Pro repo's `webhook.worker.test.ts`) and site tests pass.
- [ ] Licence text identical in `apps/site/pro-licence.txt` and both Pro packages; changeset added.
- [ ] Brief Issue 4 covers research corrections 15 to 19.
- [ ] Site and licence Worker deployed.
