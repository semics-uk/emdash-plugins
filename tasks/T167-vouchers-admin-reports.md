---
id: T167
title: "Vouchers admin and reports (money and activity kept apart)"
phase: 8
package: vouchers
edition: pro
status: in-progress
model: sonnet-5.5
size: M
depends_on: [T165]
spec: []
---

# T167 · Vouchers admin and reports

## Definition

As specified in T163 §7, in Block Kit.

- **List:** search by the last 4 characters of the code, the buyer, the recipient or an email; filter by kind,
  status and "expiring in 30 days".
- **Pages:** "To post" and "Unsettled".
- **A voucher's page:** its ledger, plus these actions:
  - void, with a reason;
  - extend expiry;
  - resend email;
  - redeem by hand;
  - release a hold;
  - issue a voucher by hand, flagged "not sold online".
- **Reports, on screen and as CSV:**
  - outstanding liability;
  - movements by month (sold, redeemed, breakage, voided, credited back);
  - money and activity always kept apart;
  - no VAT figures.

## Tests first

- Runtime host: each action writes the ledger with who did it and why. Void is refused once a voucher has
  been used. Extending an expired voucher reactivates it.
- Report totals from a fixture ledger, for each kind.

## Acceptance criteria

- [ ] Every T163 §7 action and report.
- [ ] Budget assertions present; Pro `pnpm verify` green.
