---
"@semics-tech/emdash-esign": patch
---

Phase 1 review fixes. The sign, signed-copy and verify pages pass `Astro.request` to `callPublicRoute`, which now carries the visitor's user agent, client-IP headers and Cloudflare `cf` object onto in-process route calls (never cookies, credentials or the Referer), so audit events record the signer's IP and user agent and per-IP limits apply per visitor. The default consent wording is now "I agree to use electronic records and an electronic signature for this document." and no longer claims the effect of a handwritten signature. The signature hash covers the values the signer entered and is salted with the envelope's audit salt, and the signed PDF lists the entered values. The admin envelope list pages past the newest 100 (keeping the status filter), and the new-envelope form takes signer fields, one per line as `key: Label`, ending in `*` when required.
