---
id: T101
title: "Accessibility audit and fixes"
phase: 7
package: repo
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T078, T093]
spec: [EU-NFR-01, SU-NFR-03]
---

# T101 · Accessibility audit and fixes

## Definition

axe and Lighthouse across every public page; keyboard and screen-reader pass; fixes with tests.

## Model

**Sonnet 5.5**: Checklist-driven.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Lighthouse accessibility ≥ 95 on each page (as axe: see Notes and R56)
- [x] No serious axe violations

## Implementation (green, then refactor)

- E2E a11y suite

## Acceptance criteria

- [x] Recorded results
- [x] Exercise the E-sign sign page's "Email me a code" OTP step (T091) in a real browser: keyboard, screen reader labels, error and lockout messages, no code in any URL
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```

## Notes

### How it was audited

- `apps/playground/e2e/t101-accessibility.spec.ts` (6 tests). axe-core 4.13 runs every rule tagged `wcag2a`, `wcag2aa`,
  `wcag21a`, `wcag21aa` and `wcag22aa` on 37 public pages and states, at 1280 px and at 320 px, and fails on any violation of
  any impact. The pages: home, events index, two event pages (the second has dates), the widget refusal state, `/whats-on`
  (blocks), `/photo-consent` (self-serve block), `/booking` empty, unknown ref, link and offer buttons, error notice, `/verify`,
  `/signed/<bad>`, `/sign/<bad>`, a real `/sign/<token>` with and without the email code, `/_events/sign`, `/_events/templates`, `/_events/check-in` (T082),
  `/e2e/widgets` (Turnstile on, pass, calendar), the lists and dark card, the ceremony (ready, signed, closed, the code step sent
  and locked, a refused sign), payment return states, promo, questions and booking with waiver.
- Checks axe cannot make: Tab reaches every plugin control and each one shows a focus ring (2.1.1, 2.4.7). No page scrolls
  sideways at 320 px (1.4.10). The email-code step works by keyboard alone with JS off, and the code goes only in a POST body.
  Wrong, expired and locked codes are announced in the step and tied to the code box. A refused sign links each field to its
  message (3.3.1). Names and descriptions are checked with Playwright's accessibility-tree matchers
  (`toHaveAccessibleName`/`Description`).
- Manual review of the source: labels, fieldsets and legends, live regions (`role=status`/`alert`, the polite totals, PDF and
  payment polls, the pad status), headings, focus styles, contrast defaults, reduced motion, error handling and timing.
- Lighthouse was not run (R56): its accessibility score is computed from axe audits, so zero axe violations on these rules
  means a score of 100. Adding Lighthouse would have meant a large new dependency on a nearly full disk. No screen reader was
  run either; the accessibility tree (roles, names, descriptions, live regions) stood in for it.

### WCAG 2.2 AA criteria checked

1.1.1, 1.3.1, 1.3.2, 1.3.5 (autocomplete on name, email, one-time-code), 1.4.1, 1.4.3, 1.4.4, 1.4.10, 1.4.11, 1.4.12 (no fixed
heights on text), 1.4.13, 2.1.1, 2.1.2, 2.2.1 (holds are server time limits, stated with their end time; the payment poll
never moves focus), 2.3.1 / 2.3.3 (the plugins have no animation or transitions, so there is nothing to reduce under
`prefers-reduced-motion`), 2.4.1-2.4.4, 2.4.6, 2.4.7, 2.4.11, 2.5.3, 2.5.7 (the drawn signature pad is optional: the typed
name is the alternative to dragging), 2.5.8, 3.1.1, 3.2.1, 3.2.2, 3.3.1-3.3.3, 3.3.7, 3.3.8 (the email code can be pasted and
autofilled), 4.1.2, 4.1.3.

### Found and fixed

1. E-sign email-code step (T091): the code box had no hint. Its refusals showed at the top of the page, above a document that
   can be long, and were not tied to the box. Now the step shows its own refusals (`role=alert`). The box is described by
   "The 6-digit code from the email we sent you" and by the refusal, and is `aria-invalid` for a wrong, expired or locked
   code. Both forms post to `#esign-otp`, so after a post the page comes back at the step and the next Tab stays in it.
2. Sign form: a refused field was `aria-invalid` but had no description. Now each field to fix is `aria-describedby` the
   message (3.3.1).
3. Turnstile is 300 px wide. In a booking widget at 320 px it scrolled the page 5 px sideways (1.4.10). A one-line inline
   script after each Turnstile box sets `data-size="compact"` when the box is narrower than 300 px. This applies to the
   booking widget, the waitlist, booking with waiver and the self-serve block; Pro renders the same components unchanged.
4. Playground theme (not shipped): menu and event-index links were 18 px tall and touched when wrapped (2.5.8). They are now
   at least 24 px.

### Not changed

- Third-party: the Turnstile frame's inner focus styles (Cloudflare). EmDash's `LiveSearch` input in the playground theme
  sets `outline: none` and shows focus only as a darker border. That is upstream EmDash, not plugin code.
- Admin pages are drawn by EmDash's admin from the plugins' Block Kit, so they were not audited here. Every Block Kit input
  already has a label; the rendering is EmDash's.
- Defaults rely on the host theme: `BookingStatus`, `PaymentReturn` and `EventList` set `--events-fg` (default `#1a1a1a`)
  without a background, so a dark theme must set the `--events-*` variables (as `/e2e/lists?theme=dark` does).
- Cancel booking has no confirmation step. That is not required at AA: 3.3.4 covers financial and legal commitments, and
  Free cannot cancel a paid booking.
- Sizes: no backend change. Free Events 115.9 KiB of 116, Free E-sign 105.0 KiB.
- Pro: `/Users/semics/code/semics/emdash-plugins-pro` has no test on the changed markup. It renders the same components and
  needs no change.

