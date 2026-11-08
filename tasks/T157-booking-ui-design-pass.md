---
id: T157
title: "Booking UI design pass: one card, roomy calendar, confirmed page leads with the session, print or save"
phase: 7
package: events-suite
edition: free
status: in-progress
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

- [ ] Widget: one card with even, generous inner padding; no fieldset borders (legends become small headings);
      calendar cells and gaps roomier and the month header uncramped, on desktop and at 375px.
- [ ] Attendees: one attendee row shows, plus an "Add another person" button up to the limit; works without
      JavaScript (the no-JS form still lets you book more than one place); refused-form restore still fills
      every row.
- [ ] A summary and price line sits above Book.
- [ ] Full pages: one summary card with a clear hierarchy and consistent spacing; the waiver "Signing as" strip
      lines up with the card; "Cancel booking" becomes a quiet secondary action lower down, still behind its
      confirmation.
- [ ] The confirmed page leads with the session date, time (event's zone, same format as 7) and place.
- [ ] "Print or save as PDF" button on the confirmed page (`window.print()`), with a print stylesheet: it hides
      buttons and the brand bar, and keeps the reference, date and time, attendees, total, QR tickets and the
      organiser's name and address where known. The check-in code is smaller, or shown only beside its QR.
- [ ] Items 5, 6 and 7 fixed, each with a test that fails first.
- [ ] `eventsSuite({ page: { theme, brand, stylesheet, eventPath } })` and the `--events-*` properties keep
      working; the signing page CSP still allows the stylesheet (hash) and no new inline script without its hash.
- [ ] Events backend bundle stays within budget (about 63 bytes of room): keep this to Astro components and
      their CSS, not the sandboxed backend. Bundle-size test passes.
- [ ] Changeset (patch) for each package changed; `pnpm verify` passes.
- [ ] Screenshots (desktop and 375px) of the widget, the confirmed page and its print preview, attached in the
      report.

## Notes

- LMSC handles the page around the widget (column width and spacing on the activity page) in lmsc-site.
- Pro composes these components; check that Events Pro's waiver steps still render after the markup change.
