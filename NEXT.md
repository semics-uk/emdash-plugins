# NEXT

The project's working memory. `/next` reads it first and updates it last, every run. Keep it short: move finished items to Done and prune Done to the last 10.
Task detail lives in `tasks/` (start with `tasks/ORCHESTRATOR.md`); this file only tracks the step in hand.

## Now
- Released rc.23–rc.38 (2026-11-17 to 11-25): T174f–h party packages, T176–T180 vouchers and setup check, T182–T184 voucher buy fixes (CR LF, field-naming refusals, form restore; lmsc-site can drop its workarounds), T185 #79 error logging (rc.35–37, closed), T186 local time without zone name. rc.39–40 (2026-11-26): T187 lmsc-site#151 points 2, 3, 5: `outbox-watch` every 5 min reports `outbox.stuck` once per row (Events, E-sign, Vouchers; flag v12), Vouchers `vouchers-reconcile` daily 06:40 UTC (`vouchers.reconcile_mismatch`), voucher page shows email state and points to Resend; rc.40 schedules them from Vouchers admin page loads. Point 4 (bounces) not built: needs EmDash `send()` to return a message id and a site Queues consumer (T187). Core 1.2 limits: plugin nav not filtered by role, expired-session 401 shown raw. Gaps: refund racing a hold can leave voucher live; bridge-call count not measured on host; one package per order; Bookings list and confirmation email show no lines; unnamed seats sign in the buyer's name at the door
- Sizes at rc.39: Free Events 122,984 B (920 B under the hotfix room), Pro Events 255.2 of 256 KiB, Vouchers 87.8 of 100 KiB
- Follow-ups: after Confirm time the lapse- approval_expired outbox row stays pending until its time and is then dropped (harmless; deleting it would cost Free bytes); Events Pro promo rate-limit test flaky in a slow full verify (passed on rerun); Events Pro does not trim a pasted vouchersPairing (T172 note); t145 e2e asserts a Free-only message so fails on Pro builds; booking form with a cookie-filled code could be stored by a cache that ignores cookies (docs/vouchers.md); one t168 run hit chrome-error on the T170 thanks page (passed on rerun); board.json not regenerated for T169–T172
- LMSC sells ~36 activity packages as hand-typed activityTypes lines (ids need not be Events ids; staff Redeem by hand while live booking is off)
- Version PR: since #92 release.yml dispatches CI on it and the light path passes, so it merges with no approval (`gh pr checks` does not list dispatched runs; read the head commit's check-runs)
- Local e2e: Ubuntu 26.04 has no Google Chrome and Playwright refuses the OS; install with PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 and run with a config that drops channel "chrome". The t168 thanks-page chrome-error then fails locally every time (also on main)
- Vouchers follow-ups: voucher emails are plain text; no journey test for /_vouchers/setup or buying an activity voucher; CONTRIBUTING.md "Releasing" omits vouchers-pro

## Next
- Fixes from the LMSC staging test, 2026-11-07 (Events and suite): style or theme the customer waiver and booking pages; check why a booking approved within a minute sent the organiser "New booking" with no "Booking request" email, and that the request email gives the deadline; flag bounced guest invitations to staff; keep the form's details and leave no cancelled record when a booking is refused; say a timed-out checkout lapsed; show the decline reason on the customer page and say "not charged" there and in the declined email; show event names in the admin Bookings list; show attendees while awaiting approval
- Still untested on staging: guest invitation reaching a real inbox and its link (Stackmail rejects + addresses, needs a second address), save-card path, approval deadline passing, attendee edit, T153 past a hold
- PDF timing test failed once on PR #4 CI (58 ms against a 50 ms limit), passed on re-run: probably flaky

## Monitor
- CI on main: `gh run list --branch main -L 5` (CI, Release, Staging nightly)
- Open PRs: `gh pr list` (the "version packages (rc)" PR is the release PR; merging it publishes; check its head commit's "pnpm verify" check-run first)
- Issues: `gh issue list`
- Both repos: `corepack pnpm@10.23.0 verify` (public and ../emdash-plugins-pro)
- Mac disk: 3.4 GB free after clearing npm's cache; the site build fails with no space when it is nearly full
- Events backend size: 125 KiB budget less 4 KiB hotfix room; Free Events 121,271 B (2,633 B left), Pro Events 253.5 of 256 KiB (rc.35); Vouchers 83.0 of 100 KiB

## Ideas
- Payments plugin investigation: measure what moving Stripe out of Events Pro would save (only if Events Pro size gets tight; T163)
- Templates page links straight to the event it was opened from, not the events list
- Share the slot-picker markup in the suite instead of duplicating it

## Waiting on Oli
- Decision: move out of rc to 1.0? Issue #81 has the blockers and exact steps. Recommend: not yet; first the lawyer decision, one staging pass of the untested items and a screen-reader pass
- A84 (send legal items 8-16 to the lawyer): Oli said "Not now" on 2026-11-19; do not send or re-ask until Oli raises it

## Done
- 2026-11-25 rc.35 published (T185 items 1-3, #93, Pro #24); first version PR merged with no manual CI approval (#92)
- 2026-11-25 rc.36 published (T185 item 4, #95, Pro #25)
- 2026-11-25 rc.34 published (T184 #88, found by lmsc-site staging e2e)
- 2026-11-25 rc.33 published (T181 Pro #22, T183 #84, Pro #21). Oli: merge PRs and release without asking
- 2026-11-25 rc.32 published (T182 CR LF hotfix, Pro #23, #83); lmsc-site told
- 2026-11-19 T174 marked done (#75): gaps 1-5 shipped as T174a-h, gap 6 stays on the LMSC site; LMSC told
- 2026-11-16 rc.22 published (T174e attendees after approval, Pro #14, #53; T174d per-person add-on, Pro #15, #55). rc.21 skipped: the release merged a stale version PR; release script now waits for a version PR containing main. LMSC told
- 2026-11-16 rc.20 published (T174c propose another time, customer Accept / That does not work; LMSC told)
- 2026-11-16 LMSC staging rc.19: request → pay → Confirm time passed (WPRQYYH5BC, paid once, confirmed with time, no second charge). Decline/refund still to test. rc.19 published (suite BookingWithWaiver request mode, days label, #49)
- 2026-11-16 rc.18 published (T174a booking requests and Confirm time, #45; T174b charge at request and refund on decline or lapse, #48, Pro #12). CI split into parallel jobs (#47): about 4-6 min instead of 10-13; version PR light path worked (about 1 min). LMSC cutover told
