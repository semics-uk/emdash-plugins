# NEXT

The project's working memory. `/next` reads it first and updates it last, every run. Keep it short: move finished items to Done and prune Done to the last 10.
Task detail lives in `tasks/` (start with `tasks/ORCHESTRATOR.md`); this file only tracks the step in hand.

## Now
- (none)

## Next
- Oli to decide: move the admin setup check page (about 3.2 KB) to a site-side page to save Events backend bytes (T162)
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
- Events backend size: 125 KiB budget; Free Events 119,392 bytes after T162 (rc.11)

## Ideas
- Templates page links straight to the event it was opened from, not the events list
- Share the slot-picker markup in the suite instead of duplicating it

## Waiting on Oli
- Gift vouchers spec (T163, lmsc-site#33): read and say go; build tasks T164–T168 follow

## Done
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
