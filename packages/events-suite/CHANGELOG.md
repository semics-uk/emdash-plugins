# @semics-tech/emdash-events-suite

## 1.0.0-rc.0

### Major Changes

- f0e1e43: 1.0: the trust contract is frozen (T106). Each core's capabilities, allowed hosts, public routes, MCP tools and hooks are recorded in its `trust-contract.json` and checked by a test; adding any of them is now a major version that operators consent to again. Both manifests declare the EmDash range they support (`release.requires`: `env:emdash` `>=1.2.0 <2`), so EmDash and the registry refuse an install on a host outside it.

### Minor Changes

- 5cea12a: A paid waiver booking goes to the payment page after the last signature: the waiver page asks Events to continue the booking again and follows the `pay` step (using the booking token kept on the waiver path for the flow).
- 8369d39: New package (T065): `eventsSuite()` returns both sandboxed cores, both UI descriptors and the Astro integrations, passing each core's plugin id (descriptor id, or a registry `r_…` id) to every part. `<BookingWithWaiver>` books an event with one row per attendee and an "under 18" control, refuses names with control characters before booking, and on `/_events/waiver` redeems the waiver intents with E-sign (email `draft` answers count as sent), runs each inline ceremony under E-sign's CSP and forwards each receipt to Events in-process, landing on the confirmed booking.
- 9408a83: Reconcile waiver bookings and refresh the e-sign template catalogue. Events: `public/booking` lists the refs a waiver booking still waits for (`waiver.refs`, and with Pro a lookup request for each), `public/event` says `waiver: true` when a waiver is required, a retry of `public/checkout/continue` without attendees keeps the stored ones, the editor panel's template field becomes a select of the cached catalogue with a Refresh templates button (Pro), and `eventsIntegration({ reconcile })` lets the booking page run the suite's reconciliation. Suite: the booking page forwards the receipts e-sign already holds (a signer who closed the tab or signed by email), `/_events/templates` loads the catalogue, a refused signing intent offers "Try again" instead of leaving the booking held, and `<BookingWithWaiver>` shows attendee rows only for events that require a waiver.

### Patch Changes

- c694a8f: Accessibility fixes from the WCAG 2.2 AA audit (T101). On the sign page's email-code step, the code box has a hint. Every refusal shows inside the step and is linked to the box, and a wrong, expired or locked code marks the box invalid. Both of the step's forms return to the step (`#esign-otp`). A sign-form field to fix is described by the message that says why. The Turnstile security check switches to its compact size in a container narrower than 300 px, so the booking widget, the waitlist form, the booking-with-waiver form and the self-serve block do not scroll sideways on a 320 px screen.
- 0981cf3: Phase 3 review fixes. `public/envelopes/from-intent` hands a signing token for an existing envelope only to an inline intent that names the signer the envelope awaits (same email and capacity): Events' door-signing link now works for an attendee whose emailed waiver is still open, and an intent for anyone else can no longer take over a signer's session. The waiver page's "Try again" works in a browser (the booking cookie never reached `/_events/waiver`; the flow now keeps the access token in an HttpOnly, SameSite=Strict cookie on that path). Both manifests now declare the secret settings their Pro builds store (Events: `licenceKey`, `stripeSecretKey`, `stripeWebhookSecret`; E-sign: `licenceKey`), labelled "(Pro)" and ignored by Free: without them a site switched from Pro back to Free could not read its settings, so checkout and the admin failed (trust-contract change: three and one new secret settings, BUILD-PLAN R44). The booking page stops asking e-sign about a seat whose declined, voided or expired receipt is already recorded, until continue sends that seat a new intent.
- Updated dependencies [c694a8f]
- Updated dependencies [3843621]
- Updated dependencies [68df531]
- Updated dependencies [2b99566]
- Updated dependencies [cb6f727]
- Updated dependencies [936db54]
- Updated dependencies [20f9c38]
- Updated dependencies [9c403aa]
- Updated dependencies [cbaaea2]
- Updated dependencies [2436cca]
- Updated dependencies [7897b41]
- Updated dependencies [4919885]
- Updated dependencies [a854f7f]
- Updated dependencies [c947c86]
- Updated dependencies [7868030]
- Updated dependencies [f7d4506]
- Updated dependencies [c14c6f8]
- Updated dependencies [89a5efe]
- Updated dependencies [221308b]
- Updated dependencies [abb8f62]
- Updated dependencies [242c27c]
- Updated dependencies [79df227]
- Updated dependencies [182de22]
- Updated dependencies [2f9a7ba]
- Updated dependencies [4fa83e0]
- Updated dependencies [ab176ea]
- Updated dependencies [c3639af]
- Updated dependencies [19058ec]
- Updated dependencies [08fb257]
- Updated dependencies [0ce1a3a]
- Updated dependencies [26fe1b3]
- Updated dependencies [cc440b4]
- Updated dependencies [a81557e]
- Updated dependencies [5cea12a]
- Updated dependencies [27f4517]
- Updated dependencies [f378998]
- Updated dependencies [00e9058]
- Updated dependencies [dadb75b]
- Updated dependencies [4a3300b]
- Updated dependencies [67565d8]
- Updated dependencies [83ad9f2]
- Updated dependencies [0981cf3]
- Updated dependencies [f0e1e43]
- Updated dependencies [9408a83]
- Updated dependencies [8369d39]
- Updated dependencies [d66b813]
- Updated dependencies [4c6b496]
  - @semics-tech/emdash-esign@1.0.0-rc.0
  - @semics-tech/emdash-events@1.0.0-rc.0
