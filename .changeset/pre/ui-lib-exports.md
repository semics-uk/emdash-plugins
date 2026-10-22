---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
---

The UI helpers under `src/astro/lib` are exported as `./astro/lib/*` (for example `callPublicRoute`, `forwardReceipt`, `handleSign`, `ceremonyCsp`), so the suite (T065) can compose them without importing `.astro` files.
