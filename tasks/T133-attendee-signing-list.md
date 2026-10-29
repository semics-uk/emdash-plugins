---
id: T133
title: "Suite Pro: attendee signing list and editable names before the cutoff"
phase: 7
package: suite
edition: pro
status: done
model: opus-5.5
size: M
depends_on: []
spec: [R48]
---

# T133 · Suite Pro: attendee signing list

## Definition

The customer's booking page (waiver bookings) lists every attendee with Signed / Waiting, a **Sign now**
button that opens that attendee's signing on the same device (for a shared phone or a front-desk tablet;
minors stay signed by the guardian) and **Resend** for emailed adults (rate limited, reuses the existing
invitation). Customers can add or correct attendee names and emails after booking until
`attendeeEditCutoffHours` (default 24) before the occurrence: a changed adult's open envelope is voided
and a new one sent; signed attendees can't be edited; seat count can't grow past what was bought. This
relaxes `ATTENDEES_LOCKED` (T119 F6/F7) only within the cutoff and keeps the emailed-adult cap (R48).
Staff check-in and the door-signing link stay as the backstop.

## Acceptance criteria

- [x] Tests first: list states; Sign now access (booking access token only, per attendee); Resend rate limit; edits before/after cutoff, signed attendee refused, void and reissue, caps
- [x] Booking page UI (no-JS works), i18n; call budgets
- [x] Decision recorded (next R); CONTEXT.md files and README updated; changesets
- [x] Meets the Definition of Done (Pro repo `pnpm verify` too)

## Notes

- Runs alongside T129 in `packages/events`: stay out of schedules/cron/occurrences and the panel's schedule section.
- Decision is **R95** (R94 left for T129, which runs in parallel; renumber on landing if T129 took another).
- Public side (MIT): e-sign `from-intent` honours optional intent fields `resend` and `replace` (protocol §5.1/§8.1,
  shared `IntentPayload` type); Events UI `<AttendeeList>` + `src/astro/lib/attendees.ts` on `/booking`, en + ar strings.
  The Events Free backend is unchanged (115.97 KiB); E-sign Free backend 107.1 KiB of 112.
- Pro side (`pro-agent-a32ecb7d74c66acd9`): `packages/events-pro/src/attendees` (rules + three public routes +
  `withSigningList` over `public/booking`), Pro setting `attendeeEditCutoffHours`, `trust-contract.json` gains the three
  public routes (deliberate, before 1.0), Pro backend 215.3 KiB of 256. The Pro worktree's `node_modules` links point at
  this public worktree; run `pnpm install` in the Pro repo after landing.
- The Pro repo had no `.changeset/`; this task adds `config.json`, `pre.json` (rc) and its changeset, with no tooling.
- Pro main failed its own Biome gate on two files it had not formatted (`esign-pro/src/pdf/read.ts`,
  `scripts/pro-release-workflow.test.mjs`); formatted in a separate `chore` commit.
- Not covered: waiver mode `buyer` (one receipt for the booking) gets no list; edits change name and email only (not
  "under 18" or the ticket type). The void runs just after the store, not before (see R95); a two-phase save was
  judged not worth the extra round trip.
- No playground e2e (T129 may hold the playground): the no-JS page logic is covered by `tests/ui/attendees.test.ts`
  and the routes end to end with the real e-sign bundle in Pro's `tests/attendees.editions.test.ts`.
