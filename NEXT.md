# NEXT

The project's working memory. `/next` reads it first and updates it last, every run. Keep it short: move finished items to Done and prune Done to the last 10.
Task detail lives in `tasks/` (start with `tasks/ORCHESTRATOR.md`); this file only tracks the step in hand.

## Now
- (none)

## Next
- Release workflow reports failure after a good registry publish (RELEASE_CONFLICT, rc.2 and rc.3 alike; rc.4's run passed): find out why, or report upstream to EmDash
- "Publish to the EmDash registry" showed as skipped in the Release run for #5, though Done says rc.4 reached the registry: check which is right
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
- Events backend size: 125 KiB budget, about 95 bytes of hotfix room after T151

## Ideas
- Templates page links straight to the event it was opened from, not the events list
- Share the slot-picker markup in the suite instead of duplicating it

## Waiting on Oli

## Done
- 2026-11-08 rc.6 published (LMSC staging fixes, Pro #1, T156 licence redraft): npm Free and Pro, EmDash registry; Pro skipped rc.5
- 2026-11-07 LMSC staging on rc.4: card hold, approve, decline, checkout expiry and attendee list passed in Stripe's sandbox
- 2026-11-07 lmsc-site staging moved to Pro rc.4 (Free rc.4 was already deployed from another session)
- 2026-11-07 rc.4 published (T155): npm (Free and Pro) and EmDash registry
- 2026-11-07 Staging: hand-made E-sign client cl_wvaue3o4nlndih26 revoked by D1 update; "Events on this site" kept
- 2026-11-07 lmsc-site moved to npm rc.3 (PR #8, 3960249) and deployed to staging
- 2026-11-06 rc.3 published: npm (Free and Pro) and EmDash registry; registry checksums match the attested builds
- 2026-11-06 Changesets versions the three products together; CI fetches the base branch so verify runs on PRs
- 2026-11-05 T153 intents carry `signBy`: E-sign refuses inline signatures once the hold ends (emailed seats keep E-sign's own expiry)
- 2026-11-04 T154 Free sites ask for esign/catalog-request once per process, not per Refresh
