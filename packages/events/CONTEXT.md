# Events package context

Read this instead of BUILD-PLAN.md; open a BUILD-PLAN section only when your task's `spec` cites it.

## What it is

`@semics-tech/emdash-events` carries two halves:

- **Sandboxed core** `semics-events`: `emdash-plugin.jsonc` + `src/plugin.ts`, built by `emdash-plugin build`
  into `dist/plugin.mjs` (the registry bundle holds only this half). All booking rules and data.
- **Native UI** (`src/ui`, `src/astro`, `src/client`, `src/integration`): renders public pages; talks to
  the core only through public routes via `callPublicRoute` (`src/astro/lib/call.ts`). Built with
  `tsc -p tsconfig.ui.json` after the core build. Astro components ship as source.

Free edition is MIT. Pro features (Stripe, promo codes, questions, waivers, QR check-in, reminders,
reports, MCP) are gated in a Pro build of the same slug (BUILD-PLAN §13). Free never contacts Stripe.

## Trust contract (frozen at 1.0)

- Capabilities: `content:read`, `schema:read`, `email:send`, `network:request`.
- Allowed hosts: Free `challenges.cloudflare.com`; Pro adds `api.stripe.com`. No licence-server host.
- Every public route is declared from day one (BUILD-PLAN §3.1 public routes table).

## Storage collections

`eventConfigs` (id = entry ID), `occurrences`, `ticketTypes`, `bookings`, `payments`
(id `<provider>:<sessionId>`), `attendees`, `waitlist`, `promoCodes`, `outbox`. Every document ≤ 512 KiB.

## Rules that bite

- Inventory: one `reserved` counter per ticket type / occurrence / event, guarded with
  `updateIf(..., { where: { reserved: { lte: capacity - qty } } })`; reserve in a fixed order and undo
  earlier steps on a miss (R3). Only `src/domain/inventory.ts` writes counters.
- Holds: 15 min free, 35 min paid (Stripe's 30-min minimum), extended per step to a 60-min ceiling.
  `sweep-holds` (every 5 min) is the source of truth; one-shot `hold-<ref>` cron tasks only accelerate
  (max 10 due tasks per tick). `src/domain/holds.ts` (`startHold`, `extendHold`, expiry) and
  `src/cron/sweep.ts` (T045). Expiry claims a booking by setting `releaseClaimedAt`, releases, then
  moves it to `expired`; any other writer that changes a held booking (confirm, cancel, extend,
  draft → held) must guard its `updateIf` on `releaseClaimedAt: null` (and the status it read), and
  treat a miss as "hold lapsed". Checkout schedules the accelerator with `scheduleHoldTask`.
- Checkout is two calls: `public/checkout/reserve` then `public/checkout/continue`, each ≤ 10 bridge
  calls (assert with the T007 budget harness). Reserve (`src/routes/checkout-reserve.ts`, T047) plans
  from the event config alone: `config/save` keeps a `catalog` of ticket types and occurrences on it
  (no counters; the guards pin its capacities). The booking id comes from the client's
  `idempotencyKey` and is created with `compareAndSet(id, null, …)`; a resubmit gets the same
  booking with a reissued token. The rate limit counts the IP's recent bookings (`ipHash`, salted)
  instead of KV. Reserve schedules `hold-<ref>` only when the budget has room; continue re-arms it.
  Continue (`src/routes/checkout-continue.ts`, T048) finds the booking by `ref` + token, confirms a
  free booking (then `confirmSold`, attendees, outbox `confirm-<bookingId>`, in that order: the
  outbox row marks the side effects done, so a replay writes nothing) and steps a paid one to
  `awaiting_payment` through a `PaymentStep` seam that Free leaves empty (`PAYMENT_FAILED`): `prepare` sees the
  booking as read (`held` = new, `awaiting_payment` = in-flight) and the settings, may refuse before any write; then
  `start(holdExpiresAt)` (Pro Stripe, T073: 5 Free calls + fetch + payment record = 7). A waiver booking already
  `awaiting_payment` writes back its stored seats, unsigned ones too (T119; T078 proves an emailed adult keeps their
  own name through "Pay now"), +1 = 8. The
  status graph and next-step rule live in `src/domain/booking-state.ts`.
- Free's `webhooks/stripe` is a raw route answering 503 `WEBHOOK_NOT_HANDLED` (T078), never a 200 refusal: a site
  switched back from Pro must make Stripe keep (and redeliver) payments for Pro's sessions. Pro's confirm leaves a
  waiver booking's `pending` attendees pending (their waiver is unsigned; check-in refuses them).
- Payment webhook (Pro, T074): the Pro build replaces the `webhooks/stripe` stub and composes the Free domain
  modules directly (`booking-state`, `holds`: `planExpiries`/`expireBookings`, `inventory`: `reserve`,
  `release`, `confirmSold`, `planReservation`), so keep their signatures stable. It confirms an
  `awaiting_payment` booking guarded on `{ status, releaseClaimedAt: null }` and sets `payment: { provider, ref }`;
  a late payment (R2) moves `expired` → `confirmed` (guarded on the read `releaseClaimedAt`, then cleared) after
  re-reserving from the config's `catalog`, or `expired` → `refunded_unavailable` after a refund.
  T120: a wrong paid amount or currency is refunded, never confirmed (R49); Pro's `stripe-reconcile` asks Stripe
  about stale `pending` records; a reserve with a code refused for the licence shows `PROMO_UNAVAILABLE`
  (`promoRefusal` in `src/astro/lib/widget.ts`).
- Booking status and cancel (`src/routes/booking.ts`, T049): `{ bookingRef, accessToken }` in the POST
  body; unknown ref and wrong token are the same `NOT_FOUND`. Cancel claims (`releaseClaimedAt`),
  releases seats, then moves to `cancelled`, then queues `cancel-<bookingId>`. Held bookings may always
  be abandoned; confirmed ones until `cancelCutoffHours` (setting, default 24) before the occurrence
  start (`src/domain/cancel-policy.ts`), else `CANCEL_NOT_ALLOWED`. Counters over the budget are left
  to drift repair. A cancel that takes over a stale claim (an earlier cancel died) releases nothing:
  drift repair settles the counters, so seats are never released twice (T057). Paid (T075): a confirmed booking with `payment` is refused in Free; Pro passes `bookingCancelRoute(refund)`, a `RefundStep` run after the claim (a failed refund clears the claim: `PAYMENT_FAILED`) whose `calls` shrink the counters' room and whose `mail` replaces the notice kind. `outbox-drain` takes edition renderers (`DrainDeps.render`) for kinds such as Pro's `booking_refunded`.
- Emails and calendar (`src/emails`, `src/routes/ics.ts`, `redeem.ts`, T050): outbox rows hold ids only;
  `outbox-drain` (every minute) runs the shared `drainOutbox` over an adapter (`OutboxDoc` ISO strings
  <-> `OutboxRecord` numbers) whose `email.send` renders at send time from fresh reads, two messages
  per tick (`OUTBOX_PER_TICK`; a `prefetch` reads bookings, attendees, configs, occurrences once per tick: 9-10 calls). The link is `/booking?ref=&k=<one-time code>` (hash in `redeemHash`); the
  page POSTs it to `public/booking/redeem` for a fresh access token (R34): `/booking?k=` only renders an "Open my booking"
  button; its POST calls `redeemBookingLink` (`src/astro/lib/checkout-form.ts`), sets the cookie and redirects without `k` (T056). `public/booking` also
  returns `calendar.query` (`signLink`, `events/booking-ics`, 15 min, key in KV `events:link-key`) and
  valid attendees' `code` (R33). Event fields for emails/ICS come from `src/domain/event-info.ts` (see Public event routes).
- Public event routes (`src/routes/public-events.ts`, T046): `public/events` (cached 60 s, one query) and
  `public/event` (`GET { eventId }`, the `PublicEvent` shape, 4 calls). A draft or orphaned event is
  `NOT_FOUND` (so is `public/event/ics`: `loadEventInfo(…, { publicOnly: true })`); answers carry `available` only (min of type, date, event seats left), never counters,
  capacities, hidden types or booking data. Title/times/zone/venue are read once through the mapping
  settings (`mappingOf`, `infoOfEntry` in `src/domain/event-info.ts`) and copied onto the event config
  as `info` by `content:afterSave` (`src/hooks/content.ts`) and by `config/save` when it creates a config
  (nothing else); every reader (listing, emails, ICS) takes `info` from the config and falls back to the entry
  only when it is missing. `info` is managed like `catalog`: admin edits never diff or send it.
- `callPublicRoute` passes on only the visitor's client-IP headers from `ctx.request` (pass `Astro`/`request`), so the
  per-IP reserve limit sees visitors. Event info: `infoOfEntry` takes a content item (`{ slug, data }`, the hook shape) or flat fields.
- Tokens never in URLs: booking access tokens travel in POST bodies; `callPublicRoute` refuses
  token-like keys on GET. Calendar files use short-lived signed links.
- Errors go through `toRouteError` from `@semics-tech/shared`. A wrong booking token is a 404.
- Deleting an event with bookings: `content:beforeDelete` returns exactly `false` (needs
  `content:read`); `afterDelete` marks the config orphaned as the backstop. `afterUnpublish` sets
  `unpublished` on the config (checkout and the public routes treat it like `orphaned`; `afterPublish`
  clears it and refreshes `info`). Hooks live in `src/hooks/content.ts`, each = settings read + one call.
- JSON-LD (`src/hooks/metadata.ts`, `page:metadata`): schema.org `Event` with offset dates and one
  `Offer` per visible type (3 calls); no counters, `<` is replaced in strings.
- Outbox drain: a batch whose config lacks `info` is cut to one message so the worst case stays 10 calls.
- Cron scheduling (T116, R37): EmDash 1.2 never runs `plugin:activate` for a core in `sandboxed: [...]`, so
  `public/events`, `public/event` and admin `page_load`s are wrapped in `withScheduleCheck` (shared
  `schedules.ts`): 1 KV read of `cron:scheduled:v9` (v9 since T081: `waitlist`); when missing, +1 to queue the one-shot `ensure-schedules`,
  whose tick schedules every recurring task (Free: 4, plus Pro's 4 in the Pro build: 9 calls with the flag) and sets the flag. Never add
  it to checkout or admin actions. New recurring tasks go in `RECURRING_TASKS` (`src/plugin.ts`); bump the flag version.
- Waivers (Pro): `signature.mode` `each_attendee` (default) or `buyer`. The buyer signs inline for self
  and minors; other adults sign by email; check-in refuses attendees with a pending waiver.
  Reserve copies a required waiver (`signature.required` + `templateId`) onto the booking as `waiver`;
  continue asks the Pro `SignatureStep` only for such a booking (Free ignores it), moves it to
  `awaiting_signature` and returns `next: { type: "sign", intents }`. Attendee input takes `minor: true`.
  The editor panel shows the waiver toggle only when the Pro `waivers` check says it is available, else a
  banner (Free: always). Pro composes these through `src/seams.ts` (`checkoutContinueRoute`,
  `editorTicketsRoute`, `signaturesReceiptRoute`, `adminRoute`), the only extension points; keep them
  MIT and behaviour-free (T063, T064).
- Receipts (T064, `src/routes/receipt.ts`, pure rules in `src/domain/receipts.ts`): the Free core owns the
  bookkeeping, the Pro `ReceiptStep` verifies the token (shared verifier, pairing secret) and names the
  attendees a booking waits for (the inline signers: buyer's seat and minors; mode `buyer`: every seat).
  `ref` = `<bookingRef>` or `<bookingRef>:<seat>` (attendee `<bookingId>-<seat>`); unknown = `REF_UNKNOWN`.
  The receipt is stored on the attendee (`signature`: envelopeId, status, hashes, `at`), idempotent and
  monotonic (`mergeSignature`); completed makes a pending attendee `valid`. When every awaited attendee
  is in, a free booking confirms (`confirmSold`, outbox `confirm-<id>`), a paid one goes to
  `awaiting_payment`; else a new receipt extends the hold. Declined/voided/expired are recorded and the
  booking waits (continue re-issues intents; Pro skips signed seats, and continue keeps stored attendees
  that have a signature, +1 call). Guards: status + `releaseClaimedAt: null`. 8 calls to confirm a
  one-type booking (9 with an occurrence). The Free route stays the NOT_FOUND stub (bundle).
- Check-in refuses `WAIVER_PENDING` (pending attendee on a waiver booking) after the booking check; the
  admin page shows a link from the Pro `signingLink` seam: `/_events/sign#intent=<token>&lookup=<request>` (one inline
  intent, 15 min, and the seat's lookup, 5 min). Without the seam (Free, also after a downgrade) waivers are not
  enforced: such an attendee is checked in and `public/booking` shows their pass (R44, T119 F6). UI: `/booking` is the return page (`src/client/receipt.ts` moves `#receipt=` into a
  hidden form POST, clearing the hash; `forwardReceipt` in `src/astro/lib/receipt.ts` posts it to
  `signatures/receipt` and, with the integration's `esignPluginId`, asks e-sign's `public/receipts/lookup`
  once when `pdfSha256` was null); `/_events/sign` (`DoorSignPage.astro`) redeems the intent with e-sign
  `public/envelopes/from-intent` and redirects to `/sign/<token>`; an already completed envelope (signed by email,
  receipt never posted) is looked up with the link's `lookup` and recorded ("check them in again", T119 F5).
- Reconciliation and catalogue (T066): `public/booking` of a waiver booking `awaiting_signature` (or `confirmed`,
  for its seats still `pending`: an emailed adult whose return page never ran, T119 F5) adds
  `waiver: { refs, lookups? }` (refs without a completed receipt, max 10; Pro's `bookingStatusRoute(lookups)`
  step signs an `esign-lookup/1` request per ref, +1 call for the settings). `public/event` adds `waiver: true`
  only when `signature.required`. Once a waiver booking's intents are out (`awaiting_signature`, or
  `awaiting_payment`), continue writes back its stored attendees (never replans them in the buyer's name, Free too)
  and refuses `attendees` that re-describe a seat with `ATTENDEES_LOCKED` (T119 F6/F7; emailed adults ≤ 10, R48). The
  `BookingPage` runs the integration's `reconcile` module (the suite's) when the answer has `waiver.lookups`,
  then re-reads the booking. Editor panel (Pro): the `waivers` check may return `templates` (cached in KV
  `esign:catalog` by the Pro route `esign/catalog`) and `refresh()` (the link to the suite's
  `/_events/templates#catalog=<request>`), shown as a select and a Refresh templates button
  (`panel.templates.refresh`); `waiverCalls` is 2 for Pro (settings + catalogue read). Free bundle: 102.7 KiB of 104.
- Registry installs give the core an `r_…` plugin ID, not the slug: the UI takes the ID as an option.
- `src/astro/lib/*.ts` is exported as `./astro/lib/*` (T065): the suite composes `callPublicRoute`, the checkout
  cookie helpers and `forwardReceipt` from there. Treat their signatures as public API.
- UI (T055): `<BookingWidget event>` posts a plain form to `/_events/checkout` (`returnTo`,
  `idempotencyKey`, `qty:<ticketTypeId>`); refusals before a booking exists go back to the widget as
  `?booking_error=&booking_fields=&booking_event=` (no typed values in URLs). `src/client/booking.ts`
  (no imports, budget 15 KB gz) mirrors `validateCheckoutFields` from `src/astro/lib/widget.ts`.
  Sandboxed routes answer refusals as `{ ok: false }` inside a success envelope; `callPublicRoute`
  turns that into an error. The widget expects `public/event` in the `PublicEvent` shape (T046), the
  booking page shows passes for attendees with a `code` and a calendar link from `calendar.query`
  (signed by the core, T050). Never use `set:html` or HTML sinks (a test checks). Every POST the UI
  answers (`/_events/checkout`, the booking page's cancel/redeem) refuses cross-site posts first with
  `isCrossSiteRequest` (403): EmDash sets Astro's `checkOrigin: false`, so nothing else does (T057).
- Log calls are bridge calls: a path already at 10 must not log (the outbox meters its tick, T057).
- Waitlist (T081, EV-FR-16): `public/waitlist/join` (Turnstile, shared KV `rateLimit` 5 per 10 min per IP, one live entry per
  email, event and date; answers `{ ok: true }` either way; 7 calls) writes `waiting` entries. The recurring `waitlist` task
  (`src/cron/waitlist.ts`, every minute; pure rules in `src/domain/waitlist.ts`) queries the on-sale configs (exact event
  counter), then the waiting entries of events with room, and offers the earliest that fits: entry `waiting` -> `offered`
  (guarded), a `held` booking in the waitlister's name (`waitlistId`, hold = 24 h, ceiling +60 min), the checkout
  `reserve` guards (a lost race puts the entry back), outbox `offer-<bookingId>` (kind `waitlist_offer`). A type's or
  date's counter is read only when the config cannot vouch for its room. <= 8 calls (9-10 with dates). Unclaimed offers
  are ordinary holds: the sweeper releases them and the next tick offers the next entry; every 5th minute lapsed entries
  become `expired`. The email's link is `/booking?ref=&k=<code>&offer=1`; the page's "Claim my tickets" POST calls
  `public/waitlist/claim` (= redeem for a held offer; entry -> `claimed`) then continues the booking (`claimOfferLink`).
  The widget's join form posts to the injected `/_events/waitlist` (Origin check). Retention deletes entries older than
  the period; the admin deletion by email deletes a person's entries (`email` index).
- Payment return (T077, EU-FR-09): Pro's Stripe step sets success and cancel URL to the same `/booking?ref=`, with no `session_id`, so
  the page never reads any query parameter for state. `src/astro/lib/payment.ts` (`paymentView`, `isPayUrl`) maps the core's status
  to a `<PaymentReturn>` section (`pending` = `awaiting_payment`: held, webhook maybe late; `confirmed`, `expired`, `cancelled`,
  `refunded`, `refunded_unavailable`). `src/client/payment.ts` re-reads the page (cookie goes along) at 3, 5, 8, 13, 21, 30 s, then
  un-hides "we will email you"; no-JS has "Check again" and "Pay now" (`intent=resume` -> `resumePayment`: continue with the cookie
  token, follow `pay`). Only `https:` pay URLs are followed (`handleCheckoutForm`, `resumePayment`, the suite).
- Promo codes in the widget (T078, EV-FR-14; codes are Pro's): `<BookingWidget>` shows a "Promo code" field only when
  `public/event` answers `promoCodes: true` (Pro adds it). The field and "Apply code" belong to a separate hidden form
  (`form=` attributes, so Enter in the order's fields still books) posted to the injected `POST /_events/promo`
  (`src/astro/lib/promo.ts`, `handlePromoRequest`: Origin check, `public/promo/check`, HttpOnly Lax cookie
  `semics_promo_<eventId>` for 30 min, back to the widget; refusals as `booking_error=PROMO_*&booking_fields=promo`, never
  the code). The widget re-checks the cookie's code on render (`promoView`), lists an unlock code's hidden types and puts
  the applied code in a hidden `promoCode` field of the order; `handleCheckoutForm` sends `promoCode` only when present
  (Free's reserve refuses unknown keys).
- UI (T054): `<EventList>` (also the `events-list` block) calls `public/events` through `callPublicRoute` with the
  integration's `pluginId` (virtual config module) and renders `<EventCard>`s, no client JS; states `ok`, `empty`,
  `error` (`data-state`). Time and price formatting is the pure `src/astro/lib/list.ts` (`cardView`,
  `listView`; shared `formatInZone`, unknown zone shows UTC). The `events-booking` block (`BookingBlock.astro`)
  takes an event entry id or slug (slug resolved with `getEmDashEntry`) and renders `<BookingWidget>`. `public/events`
  rows carry the entry `slug` (from `info.slug`), and list cards link to `/events/<slug>` by default (`hrefFor` overrides).
- Editor panel (T043): `admin.editorPanels` `tickets` (collection `events`) -> private route `editor/tickets`
  (`src/routes/editor.ts`, `src/admin/panel.ts`); the event id is `routeCtx.ui.entry.id`. Existing ticket types and
  dates are flat fields keyed by id (`tt_price:<id>`, `oc_start:<id>`, `*_remove:<id>`); new ones come from the
  `newTickets`/`newDates` repeaters (the Block Kit `FormField` type omits repeaters, the host accepts them). Dates are typed
  as `YYYY-MM-DD HH:mm` in the event's zone (`info.timezone`, else UTC). Saves go through `saveConfig` with the loaded state
  and an `onSaved` callback so the result renders without a read back: load = 3 calls, save <= 8. Messages for refusals
  live in `src/admin/messages.ts`. Admin event lists read titles with one `content.list` (mapped collection, 100 entries),
  falling back to `info.title` then the id.
- Site content fields are snake_case (`starts_at`, `ends_at`, `timezone`, `venue`); plugin storage
  fields are camelCase.
- Bundle size (R42, T118, R47): `dist/plugin.mjs` must stay ≤ 112 KiB (111.6 after T081, 110.9 after the T084 trims; recurrence measured at +4.5 KiB, see T084 Notes) (`tests/bundle-size.build.test.ts`; the
  registry caps a file at 128 KiB and the Pro build adds about 8 KiB on top of Free). No `zod` in the core:
  checkout bodies use the small validators in `src/domain/checkout.ts` (zod-identical issues, checked by
  `tests/domain/checkout-input.test.ts`). Shared helpers go in one place (`src/admin/ui.ts`,
  `src/routes/reply.ts`, `src/domain/time.ts`) rather than a copy per file.

## Where things live

`src/domain` pure logic (90% line coverage) · `src/routes` thin adapters · `src/storage/schema.ts`
collection names and shapes · `src/admin` Block Kit · `src/cron` jobs · `tests/` (vitest projects:
`core` in workerd, plus node projects for build checks).
