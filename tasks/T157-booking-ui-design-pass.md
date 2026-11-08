---
id: T157
title: "Booking UI design pass: one card, roomy calendar, confirmed page leads with the session, print or save"
phase: 7
package: events-suite
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T155]
spec: []
---

# T157 · Booking UI design pass

## Definition

Oli on LMSC staging (rc.6): "the initial calendar is a bit squashed, the first page you go to there is no padding
around the border and the styling looks basic and cheap. The final 'you're booked' page should have a 'print' or
something button where they can save a record of the booking."

What the LMSC session measured (desktop, 1568px):

1. **Booking widget** (`BookingWithWaiver`, `BookingWidget`): an outer bordered box holding browser-default
   fieldsets with legends ("Date", "You", "Attendee 1..4"), each with its own border. Text sits about 12px from the
   outer border. Four empty attendee fieldsets always show. Calendar day buttons are about 58px wide with 2px gaps,
   and the month header is cramped.
2. **Full pages** (`/booking`, `/_events/waiver`): every section is a plain 1px bordered box with uneven padding (16px
   and 17px). On the waiver page the "Signing as" line sits on a white strip that doesn't line up with the card edges.
   "Cancel booking" is the dark primary button at the top of a confirmed booking.
3. **The confirmed page doesn't show the session date and time**, only "1 × Clay shooting session (30 shots)".
4. **No print or save.** The check-in code prints in large monospace and wraps over three lines.

Also from the rc.6 test (2026-11-08):

5. After a refused form (`?waiver_error=`), the calendar shows "Choose a day to see its times" although the hidden
   select still holds the slot. Show the chosen day and its times again.
6. The attendee email says "Email (optional)", but every adult other than the booker must give one, and it can't be
   the booker's own address. Label it to match, for example "Email (needed for adults)".
7. Deadlines and holds read "10 Nov 2026, 12:47 (Europe/London)". The session time line already reads well; make
   deadlines read the same way (for example "UK time" when the zone is Europe/London, or no label).

## Acceptance criteria

- [x] Widget: one card with even, generous inner padding; no fieldset borders (legends become small headings);
      calendar cells and gaps roomier and the month header uncramped, on desktop and at 375px.
- [x] Attendees: one attendee row shows, plus an "Add another person" button up to the limit; works without
      JavaScript (the no-JS form still lets you book more than one place); refused-form restore still fills
      every row.
- [x] A summary and price line sits above Book.
- [x] Full pages: one summary card with a clear hierarchy and consistent spacing; the waiver "Signing as" strip
      lines up with the card; "Cancel booking" becomes a quiet secondary action lower down, still behind its
      confirmation.
- [x] The confirmed page leads with the session date, time (event's zone, same format as 7) and place.
- [x] "Print or save as PDF" button on the confirmed page (`window.print()`), with a print stylesheet: it hides
      buttons and the brand bar, and keeps the reference, date and time, attendees, total, QR tickets and the
      organiser's name and address where known. The check-in code is smaller, or shown only beside its QR.
- [x] Items 5, 6 and 7 fixed, each with a test that fails first.
- [x] `eventsSuite({ page: { theme, brand, stylesheet, eventPath } })` and the `--events-*` properties keep
      working; the signing page CSP still allows the stylesheet (hash) and no new inline script without its hash.
- [x] Events backend bundle stays within budget (about 63 bytes of room): keep this to Astro components and
      their CSS, not the sandboxed backend. Bundle-size test passes.
- [x] Changeset (patch) for each package changed; `pnpm verify` passes.
- [x] Screenshots (desktop and 375px) of the widget, the confirmed page and its print preview, attached in the
      report.

## Notes

- LMSC handles the page around the widget (column width and spacing on the activity page) in lmsc-site.
- Pro composes these components; check that Events Pro's waiver steps still render after the markup change.

### Done (agent, 2026-11-08)

- Item 5's cause: Events' picker script is a chunk shared with `<BookingWidget>`, so the bundler runs it before
  keep-form's inlined code (the import order in the `<script>` did not hold). keep-form now fires `change` on what it
  restores and the picker follows its select's `change` (skipping its own). Test: `e2e/t143-waiver-picker.spec.ts`
  "T157 after a refused form...", seen failing (aria-pressed stayed "false") before the fix.
- Item 6: "Email (needed for adults)" (`tests/widget-markup.test.ts`). Item 7: `zonedAt` now uses the widget's full date
  and short time ("Tuesday, 10 November 2026 at 12:47") with no zone name; a missing or unknown zone still says "(UTC)"
  (`tests/ui/list.test.ts`). Emails are unchanged (backend budget): they still read "10 Nov 2026, 12:47 (Europe/London)".
- Attendee rows: rows 2..`seats` (default 4, unchanged) sit in a `<details>` "Add more people (up to 4 in all)" without
  JavaScript, opened by the server when it marked one of them; with JavaScript `lib/rows.ts` shows one row and "Add
  another person", and shows every row a kept, refused form filled. It also fills the summary (date, people, total) above Book.
- `/booking`: `<BookingStatus>` leads with title, session (`event.startsAt` in the event's zone) and `event.venue` (already in
  `public/booking`'s `event`; only the UI type gained `venue`). "Who is coming" lists names when at least two differ. The print
  button, `<CancelBooking>` (a `<details>` confirmation, no JS needed) and `<PageOrganiser>` are new; `page.brand.address`
  (one line) is a new, optional page option. There was no cancel confirmation before; this adds one.
- Waiver page: the session and "signing for" lines are one card; the ceremony is a card (PAGE_CSS), so "Signing as" sits inside
  it. No new inline style or script: the CSP hash covers PAGE_CSS as before (`e2e/t065` now also checks no CSP refusals).
- Also fixed: `e2e/events.spec.ts`'s 3-zone email expectations were stale since PR #7 (the emails dropped "UTC±n").
- Screenshots: `tasks/evidence/T157/` (`T157_SHOTS=1` with `e2e/t157-booking-design.spec.ts` and `t065` rewrites them).
  `/e2e/booking-view` is a fixed-data copy of a confirmed booking with a brand, address and Pro QR passes.
