---
id: T133
title: "Suite Pro: attendee signing list and editable names before the cutoff"
phase: 7
package: suite
edition: pro
status: in-progress
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

- [ ] Tests first: list states; Sign now access (booking access token only, per attendee); Resend rate limit; edits before/after cutoff, signed attendee refused, void and reissue, caps
- [ ] Booking page UI (no-JS works), i18n; call budgets
- [ ] Decision recorded (next R); CONTEXT.md files and README updated; changesets
- [ ] Meets the Definition of Done (Pro repo `pnpm verify` too)

## Notes

- Runs alongside T129 in `packages/events`: stay out of schedules/cron/occurrences and the panel's schedule section.
