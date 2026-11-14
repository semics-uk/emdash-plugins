---
"@semics-tech/emdash-esign": patch
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-events-suite": patch
---

Themed signing pages and a cleaner pay hand-off (T169). `/sign/[token]`, `/signed/[token]` and `/verify` now take the site's look instead of the browser's defaults: `esignIntegration({ page })` accepts a `theme` (`--esign-*` properties), a whole inline `css` sheet, a `stylesheet` on the site and a `brand` (name or logo at the top, name and address at the foot). The inline sheet is allowed by its hash in the page's CSP, so nothing is loosened. `eventsSuite({ page })` passes its own page sheet, stylesheet and brand along, so on a suite site these pages match `/booking` and `/_events/waiver`; with no page options they still get the plain page sheet. EmDash's visual-edit toolbar is no longer injected into these pages or the waiver page for a signed-in editor (their CSP left it unstyled). Pressing Book on a paid booking now goes straight to the payment page by redirect. The "Continue to payment" page appears only after signing on the waiver page, and it is now a themed "Taking you to secure payment…" card. Events' integration also exports `PAGE_CSS` and `pageCss`. The sandboxed cores are unchanged.
