---
id: T159
title: "Calendar in wide columns, E-sign self-serve Turnstile, and an end-to-end booking journey test with a real PDF"
phase: 7
package: events-suite
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T158]
spec: []
---

# T159 · Calendar width, E-sign Turnstile, booking journey test

## Definition

Leftovers from T158 and the rc.8 staging check (2026-11-09):

1. **Calendar stretches in a wide column.** Since T158 the widget takes its host column's width
   (`max-inline-size: var(--events-widget-max, none)`). In a very wide column the calendar's day buttons stretch with
   it. Keep the day grid at a sensible size (cap the calendar's own width or the cell size) while the rest of the
   widget still fills the column. Applies to the calendar in `BookingWidget.astro` and `BookingWithWaiver.astro`
   (and the day picker from T130 if it shares the markup).
2. **E-sign self-serve Turnstile.** `packages/esign/src/astro/SelfServeBlock.astro` still has the old script that reads
   the box's own `clientWidth` before layout (gives compact on a desktop) and no theme. Use the same script as T158
   (measure the form, fall back to the screen width less 48 px, compact only below 300 px) and `data-theme="light"`.
   Update any CSP hash lists that carry the old script's hash.
3. **An end-to-end booking journey test.** Oli can't check the confirmed page and the printout on LMSC staging,
   because nothing gets past Turnstile there. Existing tests cover the confirmed page from fixtures
   (`/e2e/booking-view`) and one Free booking with no Turnstile. Add a Playwright journey in the playground that is as
   close to LMSC as the harness allows: Pro (see `e2e/harness/pro.ts`), a waiver, a paid ticket with the fake
   Stripe, Turnstile on (stubbed: no call to Cloudflare; siteverify faked on the server side, or Cloudflare's
   published always-pass test keys if the network is not needed). Book, sign, pay, land on the confirmed page, then:
   - check the confirmed page: every card shares the same edges, the payment box and attendee list appear, the QR pass
     and its "Show the code to type in" work, no sideways scroll at 375 px;
   - print it with `page.pdf()` (A4) and check the result: number of pages, nothing cut off at the right edge, no
     buttons or brand bar, the check-in code on one line. Save the PDF and screenshots under
     `tasks/evidence/T159/` (behind the same kind of switch as `T158_SHOTS`).

## Acceptance criteria

- [x] 1 and 2 fixed, each with a test that fails first.
- [x] The journey test runs in CI with the other Playwright specs, no network to third parties.
- [x] A PDF of the confirmed page and desktop and 375 px screenshots in `tasks/evidence/T159/`.
- [x] Events backend bundle unchanged or within budget (about 33 bytes of room). UI and CSS only, plus tests.
- [x] Patch changesets for changed packages; `pnpm verify` passes.

## Notes

### Done (agent, 2026-11-09)

Tests: `apps/playground/e2e/t159-booking-journey.spec.ts` (three tests) and four new cases in
`packages/esign/tests/ui/self-serve.build.test.ts`, committed first (21c4420). The calendar test and the four e-sign
cases were seen failing (days 122 px wide in a 60rem column; compact on a desktop, no theme, not the widgets' script).
The two journey tests pass on the unchanged UI: they are the end-to-end check Oli could not do on staging, not a fix.
`T159_SHOTS=1` writes `tasks/evidence/T159/`. `/e2e/picker` gained `?host=wide` (a 60rem host column).

1. **Calendar width.** `.semics-calendar` is `calc(min(100%, var(--events-calendar-max, 26rem)) + 0.75rem)` and the month
   nav over it is capped at the same width, in both `BookingWidget.astro` (the T130 day picker is this markup) and
   `BookingWithWaiver.astro`. Days are about 54 px wide in any wider column; the rest of the widget (times, tickets,
   fields, Book) still fills the column; at 375 px the calendar still takes the whole form. `--events-calendar-max` is
   documented in `apps/docs/pages/site-pages.md` (Styling).
2. **E-sign self-serve Turnstile.** `SelfServeBlock.astro` now has the booking widgets' T158 script character for
   character (the test compares them) and `data-theme="light"`. The test runs the inline script against fake layouts
   (box 0 px before layout, form 640 px, no form, 320/340/375 px screens). No CSP hash list carries this script: the
   block sits on ordinary site pages, and the signing pages' CSP (`packages/esign/src/astro/lib/csp.ts`) hashes its own
   inline text at render time, so nothing needed updating. It is only reachable on E-sign Pro (Free renders the
   unavailable note), so there is no browser test of the block itself.
3. **Booking journey.** Turnstile on for real: the spec saves a site key and a secret in Events settings (and clears both
   in `afterAll`, so later specs book without a token). The browser never loads Cloudflare: every request leaving
   127.0.0.1 is routed, Turnstile's api.js is answered by a stand-in that draws a box of Turnstile's size and adds the
   `cf-turnstile-response` token, and anything else is aborted and recorded (the test asserts the list is only api.js and,
   on Pro, the fake Checkout page). The server's `siteverify` is answered by `e2e/harness/stripe-preload.mjs` when
   `E2E_FAKE_TURNSTILE=1` (set in `playwright.config.ts`): success only for the one token the stand-in uses, with a DoH
   answer for challenges.cloudflare.com so EmDash's SSRF check passes offline. A second test proves the server really
   verifies: a token siteverify refuses ends on `waiver_error=TURNSTILE_FAILED` with nothing booked.
   - **Pro** (`EMDASH_PRO_DIR=<Pro checkout>`, run locally against the Pro checkout's existing build): a paid ticket
     (2 x 45.00 GBP) with a per-attendee waiver, booked on `<BookingWithWaiver>` for the buyer and a child; the buyer
     signs both waivers in the flow, the fake Stripe Checkout Session is created for 90.00, the signed webhook completes
     it, and the browser lands on `/booking` from the success URL: confirmed, "Payment received", the attendee list
     (both Signed), two QR passes.
   - **Free** (CI): the same journey without the waiver and the payment, which are Pro: Turnstile, two places on
     `london-meetup`, confirmed, two passes with the code shown in full.
   - Then on the confirmed page: every visible `main > section` card has the same left and right edges, border, radius
     and padding (desktop and 375 px); the QR hides the code and "Show the code to type in" reveals the exact
     43-character value on one line on a desktop; no sideways scroll at 375 px. In print emulation at A4's content width
     (180 mm = 680 px): no brand bar, no visible button or form, no element past the right edge, the code on one line
     (the 6.5pt print line under the QR on Pro). Then `page.pdf({ format: "A4", printBackground: true })`: page count
     from the PDF's `/Type /Page` objects (Pro: 2 pages, the Tickets card moves to page 2 as it may not break inside;
     Free: 1 page), every MediaBox A4.

Evidence (`tasks/evidence/T159/`): `confirmed-pro.pdf` and `confirmed-free.pdf`; `pro-confirmed-desktop.png`,
`pro-confirmed-375.png`, `pro-confirmed-print-a4.png`, `pro-journey-widget-desktop.png` and the same four `free-*`;
`calendar-events-wide-host.png`, `calendar-waiver-wide-host.png`.

Not possible / left out: PDF text is not inspected in the test (Chrome's text streams are compressed and CID-encoded,
and the repo has no PDF reader; no dependency was added), so the right-edge and one-line checks are made on the DOM in
print emulation at A4 width, and the PDF was read once by hand (two pages, both codes on one line, nothing cut off).
The Pro journey runs only where a Pro checkout is linked (CI's e2e job is Free, where it covers the Free half); the
Pro build used was the Pro checkout's existing `dist` (6 Nov), not rebuilt. The pre-existing
`t135-attendee-list.spec.ts` "no JavaScript" test fails on Pro independently of this task: its `bookParty` clicks
"Add another person", which only exists with JavaScript since T157.

Backend untouched (Astro components, CSS, docs and tests): `packages/events/dist/plugin.mjs` is 123,871 bytes, unchanged. Full Free e2e
run: 143 passed, 11 skipped (the Pro specs), none failed.

