---
id: T136
title: "Events: restore Free bundle headroom (at least 4 KiB under the 125 KiB budget)"
phase: 7
package: events
edition: free
status: review
model: opus-5.5
size: M
depends_on: []
spec: [R51, R94, R100]
---

# T136 · Events: Free bundle headroom

## Definition

After T129-T132 the Free Events backend is ~131 B under its 125 KiB budget (R94), 3 KiB under the
registry's 128 KiB cap, so no hotfix fits. Make at least 4 KiB of room under 125 KiB without removing a
feature: e.g. move admin-only Block Kit builders or texts that can be data, share code paths duplicated
across routes (reserve/continue/waitlist), shorten internal keys, check what the bundler pulls in from
`packages/shared` (tree-shaking, side-effect flags), compare minifier settings. Measure each change; keep
public behaviour and stored data unchanged. Record the result (R number) and the headroom in CONTEXT.md.

## Acceptance criteria

- [x] Backend ≥ 4 KiB under the 125 KiB budget, measured by the bundle-size test
- [x] All Events tests and the Pro Events suite unchanged and green (Pro builds on the Free core)
- [x] Decision recorded; CONTEXT.md; changeset (patch)
- [x] Meets the Definition of Done

## Notes

- R100 (R99 was taken by T138 meanwhile). Backend 124.9 KiB (127,869 B) → **120.9 KiB (123,774 B)**: 4,226 B under
  125 KiB, i.e. the 4 KiB room plus 130 B. `tests/bundle-size.build.test.ts` now asserts
  `bytes <= EVENTS_BUNDLE_BUDGET - EVENTS_HOTFIX_ROOM` (new constant in `@semics-tech/shared/testing/bundle-size`);
  red first at 124,951 B, green at 123,774 B.
- No minifier or tree-shaking lever: `emdash-plugin build` hard-codes tsdown (`config: false`, minify and treeshake on), and
  `plugin.mjs` is byte-identical to the registry's `backend.js`; shared already shook cleanly (no e-sign codes in the
  bundle). All savings are de-duplication, measured with a source-map breakdown per declaration.
- Behaviour-preserving, with three deliberate equivalences a reviewer should check: (1) JSON-LD offsets now come from
  `utcOffsetMinutes` instead of `Intl` `longOffset` (same `+HH:MM` for any zone with a whole-minute offset; the removed
  `offsetOf` had no other caller); (2) `planReservation` builds its steps through `countersForBooking`, which adds the
  occurrence step on a truthy id rather than `!== undefined` (an empty id never passes input validation); (3) a waitlist
  offer's booking takes `occurrenceId` when defined rather than truthy, via the shared `newBooking` (entries never store
  an empty one).
- Pro: no export Pro imports was renamed or moved (`free-domain.ts`, `free-seams.ts`, `admin/csv.ts`, `routes/attendees.ts`
  still resolve). The Pro repo's `pnpm verify` passed against this worktree (a detached Pro worktree whose
  `emdash-plugins` link pointed here; removed afterwards).
- Not done (left as candidates in R100): Block Kit `initialValue` boilerplate, admin help texts.
