# NEXT

The project's working memory. `/next` reads it first and updates it last, every run. Keep it short: move finished items to Done and prune Done to the last 10.
Task detail lives in `tasks/` (start with `tasks/ORCHESTRATOR.md`); this file only tracks the step in hand.

## Now
- T153 intent `signBy`: E-sign refuses signatures after the hold ends (agent running in a worktree; Oli said keep building 2026-11-05)

## Next
- lmsc-site PR #8 is on npm rc.2 (CI green); after Oli redeploys staging, recheck the LMSC flows against rc.2

## Monitor
- CI on main: `gh run list --branch main -L 5` (CI, Release, Staging nightly)
- Open PRs: `gh pr list` (PR #3 is the changesets release PR; merging it publishes)
- Issues: `gh issue list`
- Both repos: `corepack pnpm@10.23.0 verify` (public and ../emdash-plugins-pro)
- Events backend size: 125 KiB budget, about 95 bytes of hotfix room after T151

## Ideas
- Templates page links straight to the event it was opened from, not the events list
- Share the slot-picker markup in the suite instead of duplicating it

## Waiting on Oli
- Staging: in E-sign → Integrations, revoke the hand-made "Events" client (cl_wvaue3o4nlndih26) and keep "Events on this site"

## Done
- 2026-11-04 T154 Free sites ask for esign/catalog-request once per process, not per Refresh
- 2026-11-03 T140 cold-start test measures in a fresh Node process (Vitest's loader had tripled it)
- 2026-11-02 rc.2 published: npm (Free and Pro) and EmDash registry (semics-events, semics-esign)
- 2026-11-02 T152 ended waiver bookings void their unsigned envelopes (Pro; on next booking/waiver page visit)
- 2026-11-02 T151 waiver page handles expired bookings and draft events
- 2026-11-02 T149/T150 pairing status; templates load when you pair; one-step Refresh
- 2026-11-02 T141–T148 LMSC fixes (panel without repeaters, slot picker, auto-pairing, template ids)
