# NEXT

The project's working memory. `/next` reads it first and updates it last, every run. Keep it short: move finished items to Done and prune Done to the last 10.
Task detail lives in `tasks/` (start with `tasks/ORCHESTRATOR.md`); this file only tracks the step in hand.

## Now
- rc.23 (Pro waiver order kept), rc.24 (T174f party packages, #59, Pro #17) and rc.25 (T174g widgets check a ticket type's minimum per order before sending, #61), rc.26 (T174h waiver form books groups past 10 by quantity, up to 50, #63) published 2026-11-17, rc.27 (T176 request windows by weekday and season via config/save rules, #65) and rc.28 (T177 Vouchers admin for Authors/Editors: find, open, redeem, issue; rest Admin-only; retry-safe issue; #67, Pro #18) 2026-11-18. Core 1.2 limits: plugin nav not filtered by role, expired-session 401 shown raw. rc.29 (T178 setup check moved to site page /_events/setup, #69) 2026-11-18: Free backend 120,887 B, 3,017 B left. rc.30 (T179 Vouchers Refund: admin-only, Stripe refund + void in one step, Pro #19) 2026-11-18. T179 gaps: refund racing a hold can leave voucher live (warned, key changes with version); expired vouchers refundable (to be refused, see Next); bridge-call count not measured on host. rc.31 (T180 schema:read dropped from Free and Pro trust contracts, #73, Pro #20) 2026-11-19. Free 153 B left, Pro 387 B left; LMSC cutover told. T174f gap left: one package per order
- T174 booking requests (lmsc-site#59): all parts released by rc.22 (a, b rc.18; suite fix rc.19; c rc.20; e and d rc.22, rc.21 skipped). Free 123,094 B (810 B headroom); Pro events about 260,555 B after the waiver fix (1.6 KB headroom). Gaps: Bookings list and confirmation email show no lines; unnamed seats sign in the buyer's name at the door
- LMSC staging to try rc.16: one-click pairing at /_events/pair#vouchers, then Book with this voucher (book: true, emailBookLink)
- Follow-ups: after Confirm time the lapse- approval_expired outbox row stays pending until its time and is then dropped (harmless; deleting it would cost Free bytes); Events Pro promo rate-limit test flaky in a slow full verify (passed on rerun); Events Pro does not trim a pasted vouchersPairing (T172 note); t145 e2e asserts a Free-only message so fails on Pro builds; booking form with a cookie-filled code could be stored by a cache that ignores cookies (docs/vouchers.md); one t168 run hit chrome-error on the T170 thanks page (passed on rerun); board.json not regenerated for T169–T172
- LMSC sells ~36 activity packages as hand-typed activityTypes lines (ids need not be Events ids; staff Redeem by hand while live booking is off)
- Vouchers follow-ups: voucher emails are plain text; no journey test for /_vouchers/setup or buying an activity voucher; CONTRIBUTING.md "Releasing" omits vouchers-pro

## Next
- Vouchers Pro: refuse Refund on an expired voucher (Oli decided 2026-11-20: an expired voucher cannot be refunded; T179 allows it now). `refundable` in packages/vouchers-pro/src/domain/admin.ts: add an `isDead(v, now)` check ("This voucher has expired: it can't be refunded."); test first; Pro-only rc with a public changeset; tell LMSC
- Fixes from the LMSC staging test, 2026-11-07 (Events and suite): style or theme the customer waiver and booking pages; show UK time, not UTC or "10:30 UTC (Europe/London)", on pages and in emails; check why a booking approved within a minute sent the organiser "New booking" with no "Booking request" email, and that the request email gives the deadline; flag bounced guest invitations to staff; keep the form's details and leave no cancelled record when a booking is refused; say a timed-out checkout lapsed; show the decline reason on the customer page and say "not charged" there and in the declined email; show event names in the admin Bookings list; show attendees while awaiting approval
- Still untested on staging: guest invitation reaching a real inbox and its link (Stackmail rejects + addresses, needs a second address), save-card path, approval deadline passing, attendee edit, T153 past a hold
- PDF timing test failed once on PR #4 CI (58 ms against a 50 ms limit), passed on re-run: probably flaky
- LMSC staging runs all four packages at rc.4 (worker 1c99091f, previous 02f23216): lmsc-site PR #12 brings main's Events Pro to rc.4. Still untested: signing past a hold (T153), and the bookings test has not been rerun since Pro moved from rc.3 to rc.4

## Monitor
- CI on main: `gh run list --branch main -L 5` (CI, Release, Staging nightly)
- Open PRs: `gh pr list` (the "version packages (rc)" PR is the release PR; merging it publishes; its CI needs Oli's approval per commit)
- Issues: `gh issue list`
- Both repos: `corepack pnpm@10.23.0 verify` (public and ../emdash-plugins-pro)
- Mac disk: 3.4 GB free after clearing npm's cache; the site build fails with no space when it is nearly full
- Events backend size: 125 KiB budget; Free Events 119,392 bytes (rc.12); Events Pro 252,061 of 256 KiB; Vouchers 69,680 of 100 KiB

## Ideas
- Payments plugin investigation: measure what moving Stripe out of Events Pro would save (only if Events Pro size gets tight; T163)
- Templates page links straight to the event it was opened from, not the events list
- Share the slot-picker markup in the suite instead of duplicating it

## Waiting on Oli
- Answered 2026-11-19 08:24 via PA board: A75 (who merged #4 and #5) "Yes, or I approved it"; A84 (send legal items 8-16 to the lawyer) "Not now": do not send, do not re-ask until Oli raises it

## Done
- 2026-11-19 T174 marked done (#75): gaps 1-5 shipped as T174a-h, gap 6 stays on the LMSC site; LMSC told
- 2026-11-16 rc.22 published (T174e attendees after approval, Pro #14, #53; T174d per-person add-on, Pro #15, #55). rc.21 skipped: the release merged a stale version PR; release script now waits for a version PR containing main. LMSC told
- 2026-11-16 rc.20 published (T174c propose another time, customer Accept / That does not work; LMSC told)
- 2026-11-16 LMSC staging rc.19: request → pay → Confirm time passed (WPRQYYH5BC, paid once, confirmed with time, no second charge). Decline/refund still to test. rc.19 published (suite BookingWithWaiver request mode, days label, #49)
- 2026-11-16 rc.18 published (T174a booking requests and Confirm time, #45; T174b charge at request and refund on decline or lapse, #48, Pro #12). CI split into parallel jobs (#47): about 4-6 min instead of 10-13; version PR light path worked (about 1 min). LMSC cutover told
- 2026-11-15 rc.17 published (T173 staff issue vouchers by hand, Pro #11, lmsc-site#66; T175 Buy a Voucher layout, #43, lmsc-site #65; T170–T172 marked done); both LMSC sessions told
- 2026-11-15 rc.16 published (T171 Book with this voucher via &book=1 cookie hand-off, #40, Pro #10; T172 one-click Vouchers pairing, #41, Pro #9); LMSC told
- 2026-11-15 rc.15 published (T170 print delivery: thanks page links to the voucher via public/order and a sealed code; #38, Pro #8). rc.14 published (activity vouchers: /_vouchers/setup read Events with POST, Events only takes GET; #36, lmsc-site#56). Oli: release and merge Pro without asking. LMSC told both
- 2026-11-14 T169 merged (#34): themed /sign, /signed, /verify (esignIntegration({ page }) fed by the suite), EmDash toolbar kept off ceremony pages (relies on EmDash only injecting into responses starting <!doctype; recheck on EmDash upgrades), Book goes straight to Stripe (no pause page). Free bytes unchanged. rc.13 published (npm Free and Pro, version PR #35); cutover session told
- 2026-11-14 LMSC Agency licence lic_001eca6436c53835bcf9fd7c (staging, apex, www; updates to 2027-11-14) confirmed licensed on staging.leamarstonshootingclub.com; lic_ae46a730151fbef7e879e048 issued first and unused (key lost). New ADMIN_TOKEN on the licence Worker, kept in Oli's ~/.semics-admin-token. Upstream note: @emdash-cms/cloudflare cloudflareEmail needs from as { email, name }
- 2026-11-14 rc.12 published (T164–T168 gift vouchers): npm Free and Pro incl. new vouchers-pro (npm bootstrap done by Oli), EmDash registry; Pro release needed a GitHub billing fix; LMSC told
- 2026-11-11 rc.11 published (T162 shrink, #27): npm Free and Pro (Pro rebuilt on Free, no Pro changes), EmDash registry; LMSC staging still on rc.9
- 2026-11-11 T161 size investigation (#24), T162 shrink pass (#25, Events 123,871 → 119,444 bytes, size table in CI) and data deletion notices fix (#27) merged; Oli: no feature freeze, weigh size on every change
- 2026-11-11 Dropped the Release-failure watch item: rc.9 and rc.10 Release runs all passed
- 2026-11-11 rc.10 published (T160 waiver order, lmsc-site#21): npm Free and Pro, EmDash registry; LMSC session told the keys
- 2026-11-10 t135 no-JavaScript test now opens the "Add more people" details instead of clicking the JS-only button (lint-checked only: CI has no Pro, not run against Pro)
- 2026-11-09 LMSC staging on rc.9 (worker 9c03a23f, previous 78d98aca), deployed from lmsc-site PR #20's branch; wrangler now needs CLOUDFLARE_ACCOUNT_ID=48311ca3… (two accounts on this Mac)
- 2026-11-09 rc.9 published (T159): npm Free and Pro, EmDash registry
- 2026-11-09 T159 merged (#18): calendar capped by --events-calendar-max, e-sign self-serve Turnstile sized and light, end-to-end booking journey with an A4 PDF. CI's Playwright job had skipped e2e on every run since T001 (config check); fixed, 143 pass on Linux
- 2026-11-09 Registry job check: it is skipped on Release runs that publish nothing (e.g. #5) and runs on the version-PR merge (rc.8 published both packages); no fault
- 2026-11-08 rc.8 published (T158 polish): npm Free and Pro, EmDash registry; LMSC told
- 2026-11-08 T158 booking UI polish merged (#15): Turnstile size and theme, hover, host width, card edges, check-in code display
- 2026-11-08 rc.7 published (T157 booking UI design pass and the three rc.6 fixes): npm Free and Pro, EmDash registry; LMSC told
- 2026-11-08 LMSC staging on rc.6 (worker 4f7d7d7b): approve, decline, refused form, attendee edit, themed pages and UK times passed; signing after a lapsed hold still pending there
- 2026-11-08 rc.6 published (LMSC staging fixes, Pro #1, T156 licence redraft): npm Free and Pro, EmDash registry; Pro skipped rc.5
- 2026-11-07 LMSC staging on rc.4: card hold, approve, decline, checkout expiry and attendee list passed in Stripe's sandbox
- 2026-11-07 lmsc-site staging moved to Pro rc.4 (Free rc.4 was already deployed from another session)
- 2026-11-07 rc.4 published (T155): npm (Free and Pro) and EmDash registry
- 2026-11-07 Staging: hand-made E-sign client cl_wvaue3o4nlndih26 revoked by D1 update; "Events on this site" kept
- 2026-11-07 lmsc-site moved to npm rc.3 (PR #8, 3960249) and deployed to staging
