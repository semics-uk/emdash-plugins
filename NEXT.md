# NEXT

The project's working memory. `/next` reads it first and updates it last, every run. Keep it short: move finished items to Done and prune Done to the last 10.
Task detail lives in `tasks/` (start with `tasks/ORCHESTRATOR.md`); this file only tracks the step in hand.

## Now
- (none)

## Next
- Release workflow reports failure after a good registry publish (RELEASE_CONFLICT, rc.2 and rc.3 alike): find out why, or report upstream to EmDash
- LMSC staging is on rc.3 (version 36748163, previous 55286306): run a real booking and signing in a browser (T153 past a hold is still untested)

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
- Staging: in E-sign → Integrations, revoke the hand-made "Events" client (cl_wvaue3o4nlndih26) and keep "Events on this site"

## Done
- 2026-11-07 lmsc-site moved to npm rc.3 (PR #8, 3960249) and deployed to staging
- 2026-11-06 rc.3 published: npm (Free and Pro) and EmDash registry; registry checksums match the attested builds
- 2026-11-06 Changesets versions the three products together; CI fetches the base branch so verify runs on PRs
- 2026-11-05 T153 intents carry `signBy`: E-sign refuses inline signatures once the hold ends (emailed seats keep E-sign's own expiry)
- 2026-11-04 T154 Free sites ask for esign/catalog-request once per process, not per Refresh
- 2026-11-03 T140 cold-start test measures in a fresh Node process (Vitest's loader had tripled it)
- 2026-11-02 rc.2 published: npm (Free and Pro) and EmDash registry (semics-events, semics-esign)
- 2026-11-02 T152 ended waiver bookings void their unsigned envelopes (Pro; on next booking/waiver page visit)
- 2026-11-02 T151 waiver page handles expired bookings and draft events
- 2026-11-02 T149/T150 pairing status; templates load when you pair; one-step Refresh
