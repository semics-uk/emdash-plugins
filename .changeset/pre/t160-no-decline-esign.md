---
"@semics-tech/emdash-esign": minor
---

An integration can say a document must be signed: an intent with `noDecline: true` (esign-intent/1, optional,
ignored by older versions) creates an envelope whose signing page has no Decline button, and `public/decline`
refuses it with `DECLINE_NOT_ALLOWED` (T160).
