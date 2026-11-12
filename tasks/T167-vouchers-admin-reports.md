---
id: T167
title: "Vouchers admin and reports (money and activity kept apart)"
phase: 8
package: vouchers
edition: pro
status: done
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

- [x] Every T163 §7 action and report.
- [x] Budget assertions present; Pro `pnpm verify` green.

## Notes

All code is in the Pro repo (`packages/vouchers-pro`, branch `pro-agent-afd41f2ea1a141ea6`, commits `test(T167)` then
`feat(T167)`, plus a Pro changeset); the public repo only gets this status. Vouchers backend 66.1 KiB (67,671 bytes)
of 100 KiB.

- **Resend makes a new code.** A code is stored nowhere, so "resend email" voids the old document (pointing at the new
  one), creates the voucher under a new code and emails it (or just shows it once when no address applies; a `post`
  voucher is shown only, which is how staff get a code to print for "To post"). Refused while a hold is open. Reports
  skip the replaced original so nothing is counted twice.
- **Void is refused once used**: any spend, hand redemption, credit or open hold (a released hold does not count).
- **Release a hold** only after its window plus the 60 s allowance; the redemption moves first, as settle does.
- **Unsettled** needed a queryable marker: settle now sets `lateOpen` on a redemption when a late outcome is
  recorded; staff "Mark reviewed" (note required, ledger entry) clears it. New indexes: `vouchers.delivery`,
  `redemptions.lateOpen`. This touches T165's `redeem/settle.ts` (one line) and `domain/voucher.ts` (types, export of
  `statusOf`).
- **Who**: the signed-in user's email (else name, else "staff") from the route context.
- **Reports** scan up to 800 vouchers (8 pages) to stay within 10 bridge calls and say so when there are more; a
  precomputed rollup is the follow-up for large sites. Pairing page calls T165's `pairing/create`/`revoke` handlers.
- Not touched outside `packages/vouchers-pro` and its changeset.
