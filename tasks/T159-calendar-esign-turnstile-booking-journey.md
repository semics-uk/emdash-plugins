---
id: T159
title: "Calendar in wide columns, E-sign self-serve Turnstile, and an end-to-end booking journey test with a real PDF"
phase: 7
package: events-suite
edition: free
status: in-progress
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

- [ ] 1 and 2 fixed, each with a test that fails first.
- [ ] The journey test runs in CI with the other Playwright specs, no network to third parties.
- [ ] A PDF of the confirmed page and desktop and 375 px screenshots in `tasks/evidence/T159/`.
- [ ] Events backend bundle unchanged or within budget (about 33 bytes of room). UI and CSS only, plus tests.
- [ ] Patch changesets for changed packages; `pnpm verify` passes.
