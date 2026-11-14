---
id: T169
title: "Themed waiver signing pages; clean hand-off page before Stripe Checkout"
phase: 8
package: esign, events-suite
edition: free
status: review
model: opus-5.5
size: S
depends_on: []
spec: []
---

# T169 · Themed signing and pay hand-off

Reported from a real LMSC staging booking (2026-11-14).

## Definition

1. Booking waiver signing goes to esign's `/sign/[token]` (events `src/astro/lib/receipt.ts`, `SIGN_PATH`). esign's `SignPage.astro`
   renders with no theme, brand or stylesheet (Times New Roman, default blue links). Render `/sign/[token]`, `/signed/[token]` and
   `/verify` with the suite's page options (`eventsSuite({ page: { theme, brand, ... } })`): `pageCss(page)` inline with its hash in the
   CSP (`ceremonyCsp()` takes `{ styles, stylesheet }`), `PageBrand`, the organiser footer. Prefer `esignIntegration({ page })` fed by
   the suite, so standalone esign sites can theme it too.
2. When an admin is signed in, EmDash's visual-edit toolbar is injected into ceremony pages and shows as unstyled buttons. Suppress
   it on ceremony pages if EmDash allows; otherwise record why not.
3. After pressing pay, a "malformed" page shows for a second or two before Stripe Checkout loads (not reproduced; likely the page
   between the widget submit and the 303 to checkout.stripe.com). Find that page and make it a themed, plain "Taking you to secure
   payment…" state (or none at all).

## Acceptance criteria

- [x] Tests first; Playwright screenshots of the themed sign, signed-copy and verify pages (`tasks/evidence/T169`). The pay
      hand-off screenshot was not taken: the Pro e2e did not run (see Notes).
- [x] Byte deltas reported (Free Events plugin.mjs must not grow without reason).
- [x] Changesets added; ready for rc.13.

## Notes

- **1. Themed pages.** `esignIntegration({ page })` (new, `src/astro/lib/page.ts`): `theme` (`--esign-*`), `css` (a whole
  sheet), `stylesheet`, `brand`; checked at config time. `/sign`, `/signed` and `/verify` render in `EsignPage.astro`
  (`body.semics-page`, brand header, name and address footer) and hash the sheet into `ceremonyCsp`/`verifyCsp`
  (`verifyCsp` now takes the same extras, plus `img-src 'self'` for the logo). `eventsSuite()` always passes Events'
  `pageCss(page)` (now exported from `@semics-tech/emdash-events/integration`), so an unthemed suite site gets the plain
  page sheet too. Standalone e-sign sites get e-sign's own small sheet.
- **2. Toolbar.** EmDash 1.2 has no per-page opt-out (only site-wide `toolbar: false`). It injects only into a response
  starting with `<!doctype`/`<html` (`injectBeforeBodyEnd`). So the pages start with `DOCUMENT_START`: a comment, then
  the doctype, in one `set:html` chunk. Astro strips a literal doctype and prefixes its own unless the first chunk names
  one. The e2e test checks standards mode (`CSS1Compat`) and that a signed-in admin gets no toolbar on `/sign`, `/verify`
  and `/_events/waiver`, while the toolbar still shows on `/`. This depends on EmDash's check: re-check on an EmDash upgrade.
- **3. Pay hand-off.** The page was the suite's `/_events/waiver` "Continue to payment" page (T155: meta refresh plus a bare
  link). It was rendered for every off-site redirect, including the Book post from the site's own page. LMSC is
  pay-first, so every paid booking hit it. Book now 303s straight to Checkout, as Events' `/_events/checkout` already
  does. The hand-off stays only after a signature on the waiver page (that page's CSP blocks the redirect), now a themed
  "Taking you to secure payment…" card with a button. A site whose own pages set `form-action 'self'` would block Book's
  303, as it already blocks `/_events/checkout`.
- **Bytes:** Free Events `plugin.mjs` 119,392 B, unchanged (0 B). E-sign `plugin.mjs` 112,904 B, unchanged. Everything
  is Astro/site-side.
- **Gaps:** the Pro e2e tests for the hand-off (`t169-themed-signing.spec.ts`: pay-first goes straight to Checkout;
  sign-first shows the themed card) are written but were not run. They skip on Free, and the coordinator
  deprioritised part 3. Unit tests cover `payHandOff` and the direct redirect. Run them with `EMDASH_PRO_DIR` before
  rc.13 to get the hand-off screenshot. Pro needs no rebuild: nothing in the cores changed.
- The red commit's toolbar source checks expected a literal leading comment. The first e2e run showed Astro moves the
  doctype in front of it, so those two new checks were rewritten for `DOCUMENT_START` in a second test commit. No
  existing assertion was changed.
