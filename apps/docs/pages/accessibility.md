# Accessibility

Every public page the Free plugins render is tested against WCAG 2.2 level AA by the end-to-end tests.

## What is tested

- **Automated rules**: axe-core runs every WCAG 2.0, 2.1 and 2.2 level A and AA rule on each page: the
  booking form (with errors shown), the events list, `/booking` in each state, the waitlist and promo forms,
  questions, payment return, the waiver form, the check-in screen, the signing page (including the email-code
  step), the signed copy and `/verify`. The test fails on any violation. These are the rules Lighthouse's
  accessibility score is made of.
- **Two widths**: every page at 1280 px and at 320 px. At 320 px nothing scrolls sideways (WCAG 1.4.10,
  reflow).
- **Keyboard**: Tab reaches every control, and each one shows a visible focus ring.
- **Errors**: each refusal is tied to its field (`aria-describedby`, `aria-invalid`) and announced. On the
  signing page, the email-code step shows its own errors in place and works by keyboard alone; the code never
  appears in a URL.
- **Right to left**: the Arabic pages are tested the same way, and the layout mirrors.

The forms work without JavaScript. The exceptions are the drawing pad on the signing page (typing a name
works without it) and the Pro check-in screen (staff can use the Attendees page instead).

## Turnstile on narrow screens

Cloudflare's Turnstile box is 300 px wide. Where its container is narrower, a one-line script switches it to
Turnstile's compact size, so it fits at 320 px.

## Out of scope

- The Turnstile frame itself is Cloudflare's. Its contents are not ours to fix.
- Your site's theme. The playground's theme (EmDash's starter, with its search box) is not part of the
  plugins.
- The EmDash admin, including the plugins' admin pages, which EmDash draws from Block Kit.

If you find a barrier on a plugin page, please report it as a bug.
