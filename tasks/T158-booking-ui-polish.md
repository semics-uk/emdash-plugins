---
id: T158
title: "Booking UI polish after rc.7: Turnstile size and theme, hover, width, card edges, check-in code"
phase: 7
package: events-suite
edition: free
status: in-progress
model: opus-5.5
size: S
depends_on: [T157]
spec: []
---

# T158 · Booking UI polish after rc.7

## Definition

Found on LMSC staging (rc.7, 2026-11-08), by the browser check and the LMSC session:

1. **Turnstile size.** The widget renders Turnstile in its compact size (150×140) even on desktop, leaving a tall gap
   above Book. The inline script after `.cf-turnstile` (BookingWithWaiver.astro and BookingWidget.astro, three places)
   reads `clientWidth < 300` before the box has a width. Pick the size from the space actually available (for example
   the form's width), and keep a 320px screen from scrolling sideways.
2. **Turnstile theme.** It renders dark on the light card. Set `data-theme` to "light", or "auto" if the card follows
   the site's colour scheme.
3. **Hover looks like selected.** Hovering a calendar day gives it the same filled look as the chosen day. Hover needs
   its own lighter state, and the same goes for time slots.
4. **Widget width.** The widget caps itself at 38rem, so it sits to the left in a wider host column. LMSC overrides
   it with `.booking > .semics-events.semics-events{max-inline-size:none}`. Let the host set the width: a custom
   property (for example `--events-widget-max`) or no cap, and document it.
5. **Confirmed page card edges.** The "Payment received" box (dark 1px border, small radius, no shadow) and the
   Attendees card are narrower than the booking and Tickets cards (about 1005 against 1031px at 1568 wide), so their
   right edges don't line up. Give every section the same card style and width.
6. **Check-in code.** It still prints as a 43-character string over two lines. Oli asked for it smaller. Show a short
   form under the QR (or none, if the QR carries it), and keep the full value readable only where staff need it.
   Check what door check-in accepts before shortening anything it reads.

## Acceptance criteria

- [ ] Each of the six fixed. A test that fails first wherever behaviour can be tested (1, 4, 5 and 6 at least,
      through markup, build or Playwright tests).
- [ ] Desktop and 375px screenshots of the widget with Turnstile's box measured or stubbed, the confirmed page, and
      its print emulation, in `tasks/evidence/T158/`.
- [ ] `eventsSuite({ page })` options, the `--events-*` properties and the signing page CSP still work. Any new
      inline script needs its hash where the CSP applies.
- [ ] Events backend bundle unchanged or within budget (about 33 bytes of room). Keep this to Astro components and
      CSS.
- [ ] Patch changesets; `pnpm verify` passes; docs mention any new custom property.
