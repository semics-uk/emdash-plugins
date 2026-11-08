---
id: T158
title: "Booking UI polish after rc.7: Turnstile size and theme, hover, width, card edges, check-in code"
phase: 7
package: events-suite
edition: free
status: done
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

- [x] Each of the six fixed. A test that fails first wherever behaviour can be tested (1, 4, 5 and 6 at least,
      through markup, build or Playwright tests).
- [x] Desktop and 375px screenshots of the widget with Turnstile's box measured or stubbed, the confirmed page, and
      its print emulation, in `tasks/evidence/T158/`.
- [x] `eventsSuite({ page })` options, the `--events-*` properties and the signing page CSP still work. Any new
      inline script needs its hash where the CSP applies.
- [x] Events backend bundle unchanged or within budget (about 33 bytes of room). Keep this to Astro components and
      CSS.
- [x] Patch changesets; `pnpm verify` passes; docs mention any new custom property.

## Notes

### Done (agent, 2026-11-08)

Tests: `apps/playground/e2e/t158-booking-polish.spec.ts` (eight tests, all seen failing first, commit eb1e096) and
`packages/events/tests/ui/pass.test.ts` (`codeGroups`, seen failing first). `T158_SHOTS=1` writes `tasks/evidence/T158/`.
E2e pages gained switches: `/e2e/waiver-picker?turnstile=1&host=wide|capped`, `/e2e/widgets?host=`,
`/e2e/booking-view?sections=all` (payment box and attendee list) and `?qr=off`. `AttendeeList.astro` is now exported.

1. **Turnstile size.** The inline script now measures the form (`t.closest("form").clientWidth`), and when the form has no
   layout yet (0 px: the case that gave compact on a desktop, reproduced by hiding the host column while the page parses)
   falls back to the screen width less 48 px. Compact only below 300 px; 320 px still has no sideways scroll. Same script in
   all three places. Turnstile is stubbed in the test (a box of its real size); the exact cause on LMSC was not observed.
2. **Theme.** `data-theme="light"` on every box (the card is light unless a site themes `--events-bg` dark).
3. **Hover.** Hover is the tint plus an inset 1px accent ring with accent text; full days get no hover; the chosen day or
   time is filled and drops the ring. The old rule was already a 7% tint, so the new test failed only on the missing ring.
4. **Width.** `max-inline-size: var(--events-widget-max, none)` on both widgets; documented in `site-pages.md` (Styling).
   LMSC can drop its `.booking > .semics-events.semics-events{max-inline-size:none}` override after updating.
5. **Card edges.** `PAGE_CSS`'s card rule went from `:where(...)` (0 specificity, so `.semics-payment` and
   `.semics-attendee-list`'s own 36rem cap, 1px currentColor border and 1rem padding won) to
   `.semics-page-main > :is(section,form:not([hidden]),.semics-ceremony)`; the print rule uses the same selector. The
   components keep their own box when used outside the page.
6. **Check-in code.** It is `generateToken()`: 32 random bytes, 43 base64url characters, stored on the attendee (unique
   index). Pro's `checkin/code` (the `/_events/check-in` screen, typed or scanned from the QR; `codeFromScan` only trims) and
   the Attendees page's "Check in by code" both look it up by exact value, so any shorter form would need a backend change;
   nothing was shortened. Display only: with a QR the face shows no code, "Show the code to type in" reveals it (one line
   on a desktop, two at 375 px), and a printed pass carries it at 6.5pt on one line under the QR. Without a QR (Free) it
   shows in full at 15px in groups of four. Groups are spans spaced by CSS, so the text and a copy are the exact value.

Backend untouched (UI and CSS only), so the bundle is unchanged. The e-sign `SelfServeBlock.astro` has the same old
Turnstile script and no theme; not in this task's scope.
