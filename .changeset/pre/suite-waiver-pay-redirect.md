---
"@semics-tech/emdash-events-suite": patch
---

Signing the last waiver of a paid booking now reaches the payment page. The signing page's CSP stopped the browser following the redirect to the payment provider, leaving the signer on a disabled "Sign document" button: the page now sends them on with a meta refresh and a link.
