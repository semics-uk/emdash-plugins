# @semics-tech/emdash-events-suite

## 1.0.0-rc.6

### Patch Changes

- cc4e168: Review follow-ups to the LMSC staging fixes. An approval stays inside the bridge call limit and its Bookings page survives a failed name read. A request the organiser never decided says so, and a hold past its deadline reads as lapsed. A queued admin notice is dropped only for an ended booking. A bad locale cannot break deadlines on `/booking`, and blocked storage cannot stop the date picker. A kept form skips dates that have gone, and is forgotten on the booking page and on Back. `theme.font` reaches the signing form (`--esign-font`), and `page.stylesheet` refuses `;` and `,`.
- Updated dependencies [cc994de]
- Updated dependencies [cc4e168]
  - @semics-tech/emdash-events@1.0.0-rc.6
  - @semics-tech/emdash-esign@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- 8024a25: Fixes from the LMSC staging test. `/booking` and `/_events/waiver` have a default look and take a site's theme, brand and stylesheet (`eventsSuite({ page })`). Times show in the event's own zone. The "Booking request" email says a decision is needed and by when, and notices about a booking already decided are not sent. A refused booking form keeps what was typed and, for a waiver signed per attendee, leaves no booking. A lapsed booking says how to start again. A decline shows its reason and says when the card was not charged. The admin Bookings list names the event. The attendee list shows while a booking awaits approval, with guidance for invitations that do not arrive.
- Updated dependencies [8024a25]
  - @semics-tech/emdash-events@1.0.0-rc.5
  - @semics-tech/emdash-esign@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- 8adc1b1: Signing the last waiver of a paid booking now reaches the payment page. The signing page's CSP stopped the browser following the redirect to the payment provider, leaving the signer on a disabled "Sign document" button: the page now sends them on with a meta refresh and a link.
- @semics-tech/emdash-esign@1.0.0-rc.4
  - @semics-tech/emdash-events@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- 87ced14: An integration's signing intent can carry `signBy`. E-sign then stops taking a signature at that time plus the protocol's clock skew, closes the envelope and issues its `expired` receipt, with no call back to the integration. A later intent for the same signature can extend the deadline but never shorten it. The waiver page re-issues the seats still to sign when a signature extends the booking's hold.
- 4c68a4b: On Free Events, `/_events/pair` asks for the Pro-only `esign/catalog-request` route once per site process instead of on every pairing and Refresh templates click, so the host logs one "Route not found" rather than one per click.
- Updated dependencies [87ced14]
  - @semics-tech/emdash-esign@1.0.0-rc.3
  - @semics-tech/emdash-events@1.0.0-rc.3

## 1.0.0-rc.2

### Minor Changes

- 79cb347: New page `/_events/pair`: an administrator pairs Events with E-sign on the same site in one click. E-sign creates (or reuses) the site client and the pairing string goes straight into Events' encrypted `esignPairing` setting on the server; it is never shown or sent to the browser. Unpair revokes the client; a pairing left behind after E-sign is removed is cleared when the page is opened.
- d37b853: `<BookingWithWaiver>` books a slot-schedule event (or an event with several starts a day) through the same day-then-time picker as Events' booking widget, paging by its own `booking_from.<eventId>` parameter; dated events keep the date select.
- d8217eb: Waiver templates load in one step. Pairing on `/_events/pair` also loads the E-sign templates into Events Pro, so the event panel offers them in its select straight away, and the paired page has a Refresh templates button for templates added later (no link to follow; the request stays on the server). `/_events/templates`, where the panel's link lands, now says what to do next and links back to your events.

### Patch Changes

- 89d9cd1: `/_events/pair` recognises a pairing made by hand: it shows as paired (not revoked), and pressing Pair keeps that one client instead of leaving an unused second one. Only the client id of the stored pairing is read and passed to E-sign on the server; the secret is never sent anywhere.
- 29d95f7: When a waiver booking has expired or been cancelled before every seat signed, the booking page and the waiver page send E-sign the void intents Events Pro lists for it, so the booking's open envelopes are voided and can no longer be signed. A failed void never changes the page, and sending the same voids again is harmless.
- bff3368: The waiver page of an expired or cancelled booking says "This booking has expired. Please book again." with a link to the event, and shows no signing form; a signing post for it is refused before E-sign is asked. The event title and booked date stay on the waiver page after the event moves to draft or paused.
- 62f4b8e: The waiver page now shows the event title and the booked date and time (in the event's time zone, same format as the booking widget) above the disclaimer, read from Events' public routes.
- Updated dependencies [89d9cd1]
- Updated dependencies [79cb347]
- Updated dependencies [402b871]
- Updated dependencies [bff3368]
- Updated dependencies [e232705]
- Updated dependencies [8effa92]
- Updated dependencies [79cb347]
- Updated dependencies [74754f7]
- Updated dependencies [d8217eb]
- Updated dependencies [29d95f7]
  - @semics-tech/emdash-esign@1.0.0-rc.2
  - @semics-tech/emdash-events@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies [b037939]
- Updated dependencies [fb2f7f0]
- Updated dependencies [1e81d0b]
- Updated dependencies [1c4583e]
- Updated dependencies [485cf0d]
- Updated dependencies [a76dba3]
- Updated dependencies [d15403a]
- Updated dependencies [b5e835c]
  - @semics-tech/emdash-events@1.0.0-rc.1
  - @semics-tech/emdash-esign@1.0.0-rc.1

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
