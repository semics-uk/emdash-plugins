---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-events-suite": patch
---

When a waiver booking has expired or been cancelled before every seat signed, the booking page and the waiver page send E-sign the void intents Events Pro lists for it, so the booking's open envelopes are voided and can no longer be signed. A failed void never changes the page, and sending the same voids again is harmless.
