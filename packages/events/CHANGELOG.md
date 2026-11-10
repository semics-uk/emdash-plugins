# @semics-tech/emdash-events

## 1.0.0-rc.10

### Minor Changes

- 154c99b: The booking page supports a waiver signed after payment (Events Pro's `waiverTiming: "after-payment"`): a paid
  booking leads with "Last step: sign the waiver", whose button signs the next attendee on this device and emails
  the other adults their waiver, and unsigned attendees read "Waiver pending" (T160). Bookings signed before
  payment look as before. The Events backend is unchanged.

## 1.0.0-rc.9

### Patch Changes

- 03b3e87: The day calendar of `<BookingWidget>` (slot schedules and the T130 day picker) no longer stretches with a wide host
  column: it stays at most `--events-calendar-max` wide (default 26rem, days of about 54px), with the month and its
  Earlier / Later links over it, while the rest of the widget fills the column. On a phone it still takes the whole form
  (T159).

## 1.0.0-rc.8

### Patch Changes

- 65c2868: Booking UI polish after rc.7 (T158). `<BookingWidget>` fills its host column (it was capped at 38rem); set
  `--events-widget-max` to cap it. Its Turnstile box keeps its full size whenever the form has room (it could pick the
  compact size on a desktop) and uses the light theme. Hovering a day or a time shows a light tint and ring, no longer
  easy to mistake for the chosen one. On `/booking` the payment box and the attendee list are cards like the others, with
  the same edges. A ticket pass with a QR no longer prints its 43-character check-in code in large type: "Show the code to
  type in" reveals it on screen, and a printed pass carries it on one small line under the QR; a pass without a QR shows it
  smaller, in groups of four. The code itself, and what door check-in accepts, are unchanged. `AttendeeList.astro` is now
  exported.

## 1.0.0-rc.7

### Patch Changes

- 34b15f0: Booking UI design pass (T157). The booking widget is one card with even padding, no boxed groups and a roomier
  calendar. The `/booking` page leads with the event, the booked date and time (in the event's time zone, as the
  widget writes it) and the place, then the status, reference, order and total; sections are cards. A confirmed booking
  has "Print or save as PDF" with a print layout (no buttons or brand bar; reference, session, attendees, total, tickets
  and the organiser kept), and the check-in code is smaller, beside its QR. "Cancel booking" moves to the foot of the
  page and opens a confirmation first. Deadlines and holds read like the session time ("Tuesday, 10 November 2026 at
  12:47"), without "(Europe/London)". `page.brand.address` adds the organiser's address at the foot of the pages.
  The day-and-time picker also shows a date that another script restores into its select.

## 1.0.0-rc.6

### Patch Changes

- cc994de: A booking the organiser approved but left unpaid no longer reads as an undecided request, and a stored deadline that is no date shows as stored in emails instead of losing the message.
- cc4e168: Review follow-ups to the LMSC staging fixes. An approval stays inside the bridge call limit and its Bookings page survives a failed name read. A request the organiser never decided says so, and a hold past its deadline reads as lapsed. A queued admin notice is dropped only for an ended booking. A bad locale cannot break deadlines on `/booking`, and blocked storage cannot stop the date picker. A kept form skips dates that have gone, and is forgotten on the booking page and on Back. `theme.font` reaches the signing form (`--esign-font`), and `page.stylesheet` refuses `;` and `,`.

## 1.0.0-rc.5

### Patch Changes

- 8024a25: Fixes from the LMSC staging test. `/booking` and `/_events/waiver` have a default look and take a site's theme, brand and stylesheet (`eventsSuite({ page })`). Times show in the event's own zone. The "Booking request" email says a decision is needed and by when, and notices about a booking already decided are not sent. A refused booking form keeps what was typed and, for a waiver signed per attendee, leaves no booking. A lapsed booking says how to start again. A decline shows its reason and says when the card was not charged. The admin Bookings list names the event. The attendee list shows while a booking awaits approval, with guidance for invitations that do not arrive.

## 1.0.0-rc.4

No changes in this release.

## 1.0.0-rc.3

No changes in this release.

## 1.0.0-rc.2

### Patch Changes

- bff3368: `public/booking` answers with the event's public info (`event`: title, time zone, slug, and the booked date's start) from the config read it already makes, so a booking keeps its title and date after the event leaves sale.
- e232705: `adminRoute({ waivers })` (T142): the Event editor page takes the same waiver check as the entry panel's `editorTicketsRoute({ waivers })`, so an edition that passes both shows the same waiver state on each (the page said "Required waivers need Events Pro" on a Pro site that only lacked the E-sign pairing string).
- 8effa92: The "Tickets & booking" panel says why the waiver template list is empty: only E-sign templates marked Available to integrations are listed.
- 79cb347: The panel's pairing hint points to the suite's one-click pairing page, `/_events/pair`.
- 74754f7: The "Tickets & booking" panel and Events → Event editor can add ticket types and dates again (T141, R92): the admin's Block Kit renderer draws no repeater inside a form, so the "New ticket types" and "New dates" lists were invisible and no event could get a price. Each is now one blank row of plain fields (name, price, capacity; starts, capacity), added on save, with a fresh blank row after each save. Values from an older admin (`newTickets` / `newDates`) still parse.
- d8217eb: The panel's Refresh templates answer reads as two plain steps: "Step 1: fetch the templates", then "Step 2: reload this panel and pick one".
- 29d95f7: When a waiver booking has expired or been cancelled before every seat signed, the booking page and the waiver page send E-sign the void intents Events Pro lists for it, so the booking's open envelopes are voided and can no longer be signed. A failed void never changes the page, and sending the same voids again is harmless.

## 1.0.0-rc.1

### Minor Changes

- b037939: Attendee signing list on the booking page (T133, R95; the routes behind it are Events Pro's). When Events Pro describes a waiver booking's seats, `/booking` lists every attendee as Signed or Waiting, with a "Sign now on this device" button (the attendee signs on the buyer's phone or a front-desk tablet; a minor's guardian signs for them), "Resend invitation" for adults invited by email, and a form to correct the names and emails of attendees who have not signed until the site's cutoff. Every action is a plain form post: no JavaScript is needed. Free shows nothing new. E-sign's `public/envelopes/from-intent` honours two optional intent fields (protocol §5.1, §8.1): `resend: true` emails the open envelope's invitation again with a fresh link, and `replace: true` voids the open envelope for the seat (audited as the integration) unless it already names that signer, and never creates one. An older e-sign ignores both.
- 1c4583e: Booking approval and admin notifications: an event can require each booking to be approved (panel field **Approval hours**, 0 = off; default deadline 48 hours, never past the date's start). A finished checkout then waits as **Awaiting approval** with its places reserved; admins approve or decline it (with an optional reason) on the Bookings page, and a request not decided in time expires and frees its places. The buyer is emailed when the request arrives, is declined or expires, and gets the usual confirmation with its calendar link when approved. New settings **Admin notification emails** and **Notify admins about** (booking requests, all bookings, or nothing) email up to five admins with a link to the Bookings page. The **Event editor** admin page now opens the full Tickets & booking panel for any collection. New booking statuses `awaiting_approval` and `declined`.
- 485cf0d: Day-then-time picker: for a slot schedule, or any event with two or more dates on one day, the booking form shows a month calendar of the days that have slots, then the chosen day's times with the places left; full times are shown as full and cannot be chosen, closed ones are not shown. Earlier and Later links page by month (`booking_from` query parameter). Without JavaScript the form lists the month's times grouped by day. Keyboard and screen-reader accessible (roving focus over days and times, labelled controls), right to left included. `public/event` takes an optional `from` and answers up to 200 upcoming dates, with `more` and `slots` flags. The event calendar file, counter repair and `config/get` now read upcoming dates rather than an event's oldest ones.
- b5e835c: Slot schedules: an event can sell several time slots a day from one schedule (days, start times, minutes per slot, places, days bookable ahead, closed dates) set in the editor panel, local to the event's time zone. The `occurrences` job keeps every slot inside the book-ahead window, skips a slot time that a clock change removes and takes the first of a repeated one. Changing the schedule never moves or deletes a booked slot; unbooked slots that no longer fit leave sale at once and are deleted shortly after. The panel's **Show day** closes, reopens or changes the places of one day's slots without touching the schedule, and refuses to close a booked slot, listing its bookings. `public/event` now lists upcoming dates only.

### Patch Changes

- 1e81d0b: Booking approval: approving a request whose payment is held (Events Pro holds the card until a booking is approved) is refused by the Free edition, so a site switched back to Free never confirms such a request unpaid; it expires uncharged. Deleting personal data now also erases the reason given when a request was declined.
- a76dba3: The Free Events backend is 4.1 KiB smaller (120.9 KiB, R100, T136), so it again has room for a hotfix under its 125 KiB budget. Nothing changes for sites or buyers: code that the core carried more than once (status lists, sorting, booking lookups, new booking documents, emailed link codes, cron state, time formatting) now lives in one place. `@semics-tech/shared` adds `utcParts`, `pad2`, `validZone` and exports `WEEKDAYS`.
- d15403a: "Pay now" keeps the attendees typed at checkout (T134, R101): continuing a booking that awaits payment without naming attendees (the booking page's Pay now, including Events Pro's approved booking whose saved card was refused) writes back its stored seats (names, emails, under-18 flags, waiver signatures) and only re-runs the payment step; a booking with no seats stored yet still names them after the buyer. The day-then-time picker pages on its own `booking_from.<eventId>` query parameter, so two booking widgets on one page page independently, with or without JavaScript. The booking page names each ticket type ("3 × Class place") instead of showing its id.

## 1.0.0-rc.0

### Major Changes

- f0e1e43: 1.0: the trust contract is frozen (T106). Each core's capabilities, allowed hosts, public routes, MCP tools and hooks are recorded in its `trust-contract.json` and checked by a test; adding any of them is now a major version that operators consent to again. Both manifests declare the EmDash range they support (`release.requires`: `env:emdash` `>=1.2.0 <2`), so EmDash and the registry refuse an install on a host outside it.

### Minor Changes

- 242c27c: Add private `config/get` and `config/save` routes with validation for event booking configs, ticket types and occurrences.
- 79df227: Add `<BookingWidget>`, `<BookingStatus>`, `<TicketPass>` and `<AddToCalendar>` to the `./astro` entry. The widget is a plain form that books without JavaScript, shows errors next to their fields, sends a fresh idempotency key per attempt and adds Turnstile when a site key is set; a 2 KB client script enhances it. `callPublicRoute()` now reports a route's own `{ ok: false }` answer as an error (with its validation issues), so the no-JS checkout no longer treats a refused reservation as a booking.
- 182de22: Add `callPublicRoute()` to the `./astro` entry: UI components call the sandboxed core's public routes in-process, with a server-side `fetch` fallback.
- 2f9a7ba: Add `public/checkout/continue`: authenticated by the booking ref and access token in the body, it writes the attendees, confirms free bookings (counting the seats as sold) and queues the confirmation email, returning `next: { type: "done" }`. Idempotent: a replay writes nothing. A lapsed or claimed hold answers `HOLD_EXPIRED`; the Free edition refuses paid bookings with `PAYMENT_FAILED`. Adds the shared booking state machine (`src/domain/booking-state.ts`).
- 4fa83e0: Send booking emails and serve calendar files. The `outbox-drain` cron task (every minute) renders the queued confirmation and cancellation emails at send time (the queue holds ids only) and sends one per tick through the shared outbox. The confirmation links to `/booking?ref=…&k=…`, a one-time code (only its hash is stored) that the new `POST public/booking/redeem` route exchanges for a fresh access token, so no access token is ever emailed or put in a URL. `GET public/booking/ics` (15-minute signed link) and `GET public/event/ics` return `text/calendar` in the event's time zone; `public/booking` now returns `calendar: { query }` and each valid attendee's check-in `code` to the token holder. Adds a public route, so the public surface grows by one declared route.
- ab176ea: Add the "Tickets & booking" editor panel on event entries (sale status, ticket types, dates, live sold and held stats) and show event titles in the admin event lists.
- c3639af: The booking page handles the emailed `?ref=&k=` link: it shows an "Open my booking" button and only its POST redeems the one-time code (`public/booking/redeem`), sets the HttpOnly booking cookie and redirects without `k`, so mail scanners that prefetch links can't use it up. `public/events` rows carry the entry's `slug` and `<EventList>` links each card to `/events/<slug>` by default (`hrefFor` still overrides). The event info copy now reads EmDash's content item shape (`{ slug, data }`) in `content:afterSave`/`afterPublish`, which previously left it stale. `callPublicRoute` takes the visitor's `request` and passes on its client-IP headers (never cookies), so the per-IP checkout limit counts visitors instead of one shared unknown address.
- 19058ec: Add seat holds: 15-minute free and 35-minute paid holds, step extensions capped at the 60-minute ceiling, and the `sweep-holds` cron (scheduled every 5 minutes on activation) that expires lapsed holds in budgeted batches and repairs counter drift with a cursor kept in KV. One-shot `hold-<ref>` tasks expire a booking on time and only accelerate the sweeper.
- 08fb257: Add the inventory reservation engine: guarded `reserved` counters per ticket type, occurrence and event, reserved in a fixed order with compensation, plus drift repair from live bookings. `config/save` no longer rewrites counters: it updates changed fields with a guarded write, closes documents before deleting them, and refuses saves that would exceed the call budget (`TOO_MANY_CHANGES`).
- 0ce1a3a: Add `<EventList>` and `<EventCard>` (server-rendered from `public/events`, each event in its own time zone, no client JavaScript) and the `events-booking` Portable Text block that renders `<BookingWidget>`. The `events-list` block now reads the real events route.
- 26fe1b3: Register an `events-list` Portable Text block from the UI entry and render it with the `./astro` `blockComponents` export.
- cc440b4: Declare the Free trust contract: capabilities `content:read`, `schema:read`, `email:send` and `network:request`, outbound host `challenges.cloudflare.com` only, nine storage collections with their indexes, and the settings schema (collection mapping, hold times, currency, Turnstile keys, e-sign pairing, retention, sender name). Every public route is registered with a stub handler until its feature lands.
- a81557e: The integration injects `/_events/opt-out`, the page behind the unsubscribe link in Events Pro's reminder and update emails: opening it changes nothing, its button asks the core's `public/mail/opt-out` (Events Pro). The self-scheduling flag moves to `cron:scheduled:v11` so sites already scheduled pick up Events Pro's `reminders` task.
- 5cea12a: The booking page now explains what happened after the payment page: paid and confirmed, waiting for the payment provider (it re-reads the booking politely for about 80 seconds, then says we will email), abandoned with the seats still held (a "Pay now" button), expired, refunded, and refunded because the tickets sold out first. The state always comes from the core, never from the URL the provider returns to. New `<PaymentReturn>` component, `resumePayment` helper, and the redirect to the provider is followed only for `https:` URLs.
- 00e9058: Promo codes in the booking widget and fixes from the Phase 4 payments review. When the core takes promo codes (Events Pro says so in `public/event` with `promoCodes: true`) the widget shows a "Promo code" field with its own "Apply code" form, posted to the new injected `POST /_events/promo` (Origin-checked, works without JavaScript): it asks `public/promo/check`, keeps an accepted code in an HttpOnly cookie for the event (never in a URL), shows what it takes off and, for an unlock code, the hidden ticket types it reveals; the order then carries the code as `promoCode`. Free sites show no field and send no `promoCode`. Fixes: `webhooks/stripe` in the Free core now answers 503 instead of a 200 refusal, so a Stripe payment made after switching from Pro back to Free is redelivered once Pro is back rather than lost; and continuing a paid waiver booking that awaits payment ("Pay now") keeps its stored attendees, so an adult who signs by email keeps their own name, email and ticket code.
- dadb75b: Add the `./integration` entry (`eventsIntegration({ pluginId })`): injects the no-JS checkout endpoint `/_events/checkout` and the `/booking` page (`Referrer-Policy: no-referrer`, access token in an HttpOnly cookie, never in a URL). Registry installs pass their `r_…` plugin id.
- 4a3300b: Waitlist for sold-out events. With "Waitlist when sold out" on, the booking widget shows a "Join the waitlist" form once tickets (or a date) are sold out. When seats come free, the new `waitlist` cron task (every minute) holds them for the first person in line for 24 hours and emails a one-time claim link; claiming it on the booking page confirms a free booking (or goes to payment), and an unclaimed offer passes to the next person. Joining has a bot check and a per-connection limit. Waitlist entries are deleted by the retention job after the retention period and by the admin's "Delete personal data" (by email). The schedules flag moves to v9, so both cores schedule their recurring tasks once more.
- 9408a83: Reconcile waiver bookings and refresh the e-sign template catalogue. Events: `public/booking` lists the refs a waiver booking still waits for (`waiver.refs`, and with Pro a lookup request for each), `public/event` says `waiver: true` when a waiver is required, a retry of `public/checkout/continue` without attendees keeps the stored ones, the editor panel's template field becomes a select of the cached catalogue with a Refresh templates button (Pro), and `eventsIntegration({ reconcile })` lets the booking page run the suite's reconciliation. Suite: the booking page forwards the receipts e-sign already holds (a signer who closed the tab or signed by email), `/_events/templates` loads the catalogue, a refused signing intent offers "Try again" instead of leaving the booking held, and `<BookingWithWaiver>` shows attendee rows only for events that require a waiver.
- 4c6b496: Translations and right-to-left layouts for the UI kits (T102). Every text the Events and E-sign components, pages and client scripts show now comes from `src/i18n` (exported as `./i18n`), which ships English and Arabic. Components take a `locale` prop; without one they use the page's locale when the site configures Astro i18n, else British English. Each component sets its own `lang` and `dir`, the injected pages set them on `<html>`, and the styles use logical sides, so Arabic pages mirror. Client scripts read their messages from the page instead of carrying English. The sandboxed cores are unchanged: they still answer with codes, and the message tables stay out of the backend bundle. `docs/i18n.md` explains how to add a language.

### Patch Changes

- c694a8f: Accessibility fixes from the WCAG 2.2 AA audit (T101). On the sign page's email-code step, the code box has a hint. Every refusal shows inside the step and is linked to the box, and a wrong, expired or locked code marks the box invalid. Both of the step's forms return to the step (`#esign-otp`). A sign-form field to fix is described by the message that says why. The Turnstile security check switches to its compact size in a container narrower than 300 px, so the booking widget, the waitlist form, the booking-with-waiver form and the self-serve block do not scroll sideways on a 320 px screen.
- 3843621: Smaller sandbox backends with no change in behaviour. Events validates checkout bodies with a small built-in validator instead of `zod/mini` (same rules, same issue paths and codes), both cores drop unused shared code, and repeated helpers now exist once. The Events backend goes from 119.8 KiB to 95.1 KiB and E-sign from 100.9 KiB to 99.3 KiB, well under the registry's 128 KiB per-file limit.
- 68df531: Schedule recurring cron tasks even when EmDash never runs `plugin:activate`, which is the case for cores listed under `sandboxed: [...]` in `astro.config.mjs`. Events now sweeps expired holds and sends its emails on an npm/config install, and E-sign drains its outbox. The first public event read, admin page load, template creation or verify-page call schedules them once.
- 2b99566: Registry listings and docs (T103). Both manifests gain a display name, keywords, the profile sections (description, installation, FAQ, security, kept in `listing/`) and release images (icon, banner, screenshots made by the playground's Playwright spec). No capability, host, storage or route changed. The READMEs now point at the operator guides in `apps/docs`, and the E-sign retention notes say that the certificate keeps the participant's (minor's) name and the signed PDF keeps "Details entered by the signer" until the signed-records period ends.
- 221308b: E-sign: signing intents now only start envelopes from templates marked "Available to integrations" (a new toggle on the template forms; existing templates start switched off, so turn it on for the templates your Events site uses). Consumed intent nonces are deleted by an hourly `nonce-sweep` task once they can no longer be replayed. Both cores re-run their one-time schedule check after this update so the new task is scheduled.
- 27f4517: The checkout `PaymentStep` extension point now has `prepare` (given the booking as read and the settings checkout already loaded, run before any write, may refuse) and a `start(holdExpiresAt)` that may refuse with an error code. The Free edition is unchanged: it has no payment step and refuses paid bookings with `PAYMENT_FAILED`. Continuing a paid waiver booking that already awaits payment keeps its signed attendees instead of rewriting them.
- f378998: Phase 2 review fixes. The checkout endpoint and the booking page's cancel and redeem forms refuse cross-site posts themselves (403): EmDash turns Astro's `security.checkOrigin` off, so they had no CSRF protection before. `public/event/ics` answers `NOT_FOUND` for an event in draft, unpublished, orphaned or without a config, like `public/event`. Cancelling a booking whose earlier cancel died after claiming it no longer releases its seats a second time (drift repair settles them). The outbox drain skips its give-up log on a tick that already used all 10 bridge calls.
- 67565d8: Waiver bookings are sturdier. Once a booking is waiting for signatures, continuing it keeps the attendees it has (a changed name, email or "under 18" is refused with `ATTENDEES_LOCKED`), in the Free edition too, so a booking that was mid-signing when a site switched from Pro back to Free keeps its signatures. On Free, attendees a Pro waiver left pending get their pass and can be checked in. The booking page also reconciles a confirmed booking's seats that are still pending, and the door signing page records a waiver that was already signed by email. Return paths that resolve to `//host` are refused.
- 83ad9f2: Waiver receipts and waiver-gated check-in (EV-FR-12, T064). New MIT seams for a Pro build: `signaturesReceiptRoute({ receipts })` stores e-sign receipts per attendee (idempotent, monotonic) and moves a booking out of `awaiting_signature` once its inline signers are in (confirming a free booking, `awaiting_payment` for a paid one), and `adminRoute({ signingLink })` shows a signing link when check-in refuses an attendee whose waiver is pending (new refusal `WAIVER_PENDING`). The Free `signatures/receipt` route is unchanged (NOT_FOUND). Continuing a booking that awaits signatures keeps attendees whose receipts are in. The `/booking` page is the waiver return page (it posts `#receipt=` to `signatures/receipt`), the integration injects `/_events/sign` (door signing) and takes an optional `esignPluginId`.
- 0981cf3: Phase 3 review fixes. `public/envelopes/from-intent` hands a signing token for an existing envelope only to an inline intent that names the signer the envelope awaits (same email and capacity): Events' door-signing link now works for an attendee whose emailed waiver is still open, and an intent for anyone else can no longer take over a signer's session. The waiver page's "Try again" works in a browser (the booking cookie never reached `/_events/waiver`; the flow now keeps the access token in an HttpOnly, SameSite=Strict cookie on that path). Both manifests now declare the secret settings their Pro builds store (Events: `licenceKey`, `stripeSecretKey`, `stripeWebhookSecret`; E-sign: `licenceKey`), labelled "(Pro)" and ignored by Free: without them a site switched from Pro back to Free could not read its settings, so checkout and the admin failed (trust-contract change: three and one new secret settings, BUILD-PLAN R44). The booking page stops asking e-sign about a seat whose declined, voided or expired receipt is already recorded, until continue sends that seat a new intent.
- 8369d39: The UI helpers under `src/astro/lib` are exported as `./astro/lib/*` (for example `callPublicRoute`, `forwardReceipt`, `handleSign`, `ceremonyCsp`), so the suite (T065) can compose them without importing `.astro` files.
- d66b813: The check-in screen's accent colour defaults to `#0b57d0`, like every other component, so `--events-accent` has one default. The site-pages guide lists every `--events-*` and `--esign-*` custom property with its default (EU-NFR-05).
