---
"@semics-tech/emdash-esign": patch
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-events-suite": patch
---

Phase 3 review fixes. `public/envelopes/from-intent` hands a signing token for an existing envelope only to an inline intent that names the signer the envelope awaits (same email and capacity): Events' door-signing link now works for an attendee whose emailed waiver is still open, and an intent for anyone else can no longer take over a signer's session. The waiver page's "Try again" works in a browser (the booking cookie never reached `/_events/waiver`; the flow now keeps the access token in an HttpOnly, SameSite=Strict cookie on that path). Both manifests now declare the secret settings their Pro builds store (Events: `licenceKey`, `stripeSecretKey`, `stripeWebhookSecret`; E-sign: `licenceKey`), labelled "(Pro)" and ignored by Free: without them a site switched from Pro back to Free could not read its settings, so checkout and the admin failed (trust-contract change: three and one new secret settings, BUILD-PLAN R44). The booking page stops asking e-sign about a seat whose declined, voided or expired receipt is already recorded, until continue sends that seat a new intent.
