---
id: T177
title: "Vouchers admin for desk staff (Authors), retry-safe issue by hand"
phase: 8
package: vouchers-pro
edition: pro
status: done
model: opus-5.5
size: S
depends_on: [T167]
spec: []
---

# T177 Vouchers admin for desk staff

Asked by the LMSC cutover session, 2026-11-18 (lmsc-site #114, #115).

## Need

- **#114.** Authors view and search vouchers, redeem them (part or all) and issue money or activity vouchers by hand.
  They get no pairing, settings, licence or report export, and no wider admin rights.
- **#115.** Issuing by hand showed "Plugin responded with 401 … Authentication required". That is core's answer when
  there is no session at all (an Author gets 403), so the session had most likely expired. The issue action must be
  safe to retry.

## Cause

EmDash core authorises a private plugin route with `routeMeta.permission ?? "plugins:manage"`. `admin` declared no
permission, so only Administrators got in.

## Done (Pro)

- **Route permission.** `admin` declares `permission: "content:publish_own"`, so Authors and up get in.
  `reports/export`, `pairing/create`, `pairing/revoke` and `pro/licence` keep core's default, which is Administrators.
- **Inside `admin`.** Below Administrator (role 50), Authors and Editors get the desk only:
  - the Vouchers and Issue pages;
  - search, list and open;
  - redeem by hand;
  - issue, and email the code just issued.

  Every other page or action answers "Administrators only". The voucher page hides the void, extend, resend, release
  and posted forms. The ledger already records the acting user's email (`actorName`).
- **Retry-safe issue.** The issue form's submit carries a one-time key, which is claimed as `issue:<key>` in `orders`
  before the voucher is written. The same submission again answers "Already issued" with an Open button. A form
  without a key (a page left open across the release) still issues.
- **Tests.** `packages/vouchers-pro/tests/roles.unit.test.ts` covers Author, Editor, Admin and no user, plus the retry
  cases.

## Not done (core limits, EmDash 1.2)

- **Nav.** Plugin admin pages carry no `minRole`, so Authors still see the Pairing, Reports, Unsettled and To post
  entries. Those pages say "Administrators only". Hiding them needs a core change.
- **Expired-session message.** Core answers 401 before the plugin runs, so the raw message comes from the admin UI. A
  friendlier "Your session has ended, please sign in again" needs a core change.
