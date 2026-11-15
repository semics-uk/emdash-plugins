---
id: T173
title: "Staff issue vouchers by hand: buyer and recipient, reason and payment, print and email"
phase: 8
package: vouchers-pro
edition: pro
status: in-progress
model: opus-5.5
size: M
depends_on: [T172]
spec: [T163]
---

# T173 · Staff issue vouchers by hand

From lmsc-site#66 (staff create and issue vouchers in the admin). The requirements table is in lmsc-site PR #67,
`docs/staff-vouchers.md`. The admin **Issue a voucher** page (`vouchers.issue`, `vn()` in `admin.ts`) at rc.16
already covers money and activity vouchers, a unique code, list and search, a ledger with `by`, part-redeem by hand
and no checkout. The gaps:

## Definition

1. **R3, buyer and recipient.** The Issue form takes the buyer's name and email and the recipient's name and email
   (each optional), a personal message, and an optional issue date (today or earlier, not later; backdating moves
   `issuedAt` and so the default expiry). Today `holderName`/`holderEmail` are stored as the buyer, the recipient is
   null, there is no message, and `issuedAt` is always now.
2. **R5, reason and payment.** Structured fields on Issue: reason (in-person sale, telephone, complimentary,
   replacement, other), payment method (card in shop, cash, bank transfer, n/a) and payment status (paid, unpaid,
   complimentary). They are stored on the voucher, shown on its page, searchable or filterable on the list, and in
   the reports and CSV. Issue also takes an exact expiry date as an alternative to months.
3. **R6/A3, print and email.** The "Voucher issued" result has a **Print** button that opens
   `/_vouchers/v?c=<code>` in a new tab, and an **Email to** field and button that sends the voucher email with that
   code. Both work only on that screen, while the code is still in hand.
4. **R1/R2.** A "Create voucher" button on the Vouchers list page opens Issue. Activity vouchers take an optional
   price override at issue time (the value recorded for reports; it does not change the activity line).

## Decision: no "email without a new code"

A code is stored nowhere, only its hash (T163, `voucher/1` §7), so an existing voucher cannot be emailed again with
the same code. **Resend with a new code** stays the way to send an existing voucher again. Issue's Email button
covers sending at issue time. Staying as is: storing codes would undo the design that a database leak gives no
working codes.

## Acceptance criteria

- [ ] Tests first (separate commit) in `packages/vouchers-pro/tests`: issue with buyer and recipient, message,
      backdate (future date refused), reason and payment fields stored, shown, filtered, in reports and CSV,
      exact expiry, price override, Print link and Email action on the issued screen, Create button on the list.
- [ ] Existing stored vouchers without the new fields still read, list and export.
- [ ] Vouchers backend bytes reported (budget 100 KiB). Free Events unchanged.
- [ ] Pro changeset (vouchers-pro patch). `pnpm verify` passes in the Pro repo.
