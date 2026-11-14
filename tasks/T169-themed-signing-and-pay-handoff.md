---
id: T169
title: "Themed waiver signing pages; clean hand-off page before Stripe Checkout"
phase: 8
package: esign, events-suite
edition: free
status: in-progress
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

- [ ] Tests first; Playwright screenshots of the themed sign page and the pay hand-off.
- [ ] Byte deltas reported (Free Events plugin.mjs must not grow without reason).
- [ ] Changesets added; ready for rc.13.
