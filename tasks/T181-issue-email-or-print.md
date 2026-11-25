---
id: T181
title: "Vouchers: issue by hand asks Email or Print; refused purchases logged"
phase: 8
package: vouchers-pro
edition: pro
status: done
model: opus-5.5
size: S
depends_on: [T177]
spec: []
---

# T181 Issue by hand: Email or Print

Asked by the lmsc-site session after lmsc-site #148 and #155. The scope is issue #79 item 6, plus the #79 logging
principle. Oli picked this version on 2026-11-24. Released in rc.33 (Pro #22).

## Need

Staff voucher …4KPQ (21 Nov, £50 phone sale) was issued as `print` with the buyer's email on file. "Email the
voucher" was never pressed, so the customer never got it. Her failed online try left no trace of why.

## Done (Pro)

- **Issue form.** A required "How do they get it?" choice: *Email it now* or *Print it or hand it over*, with no
  default.
  - Email issues the voucher and queues the code email in the same step, to the recipient's email or else the buyer's.
    It adds an `Emailed to …` ledger note and sets the delivery to `email-recipient` or `email-buyer`.
  - Print with an email on file comes back once with a warning and a *Print only* switch.
  - A form sent back (any error) keeps what was typed.
- **Logging.** `public/purchase` logs every refusal through `ctx.log` with `{ code, step }`.
  - Stripe refusals and crashes are logged as errors, with Stripe's HTTP status and error type and code.
  - No buyer input is logged.

## Not done (dropped by Oli for #79)

The email state on the voucher list and page, refusal counts in Reports, and a health endpoint. The Turnstile bypass
token was declined.
