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
  `awaiting_payment` through a `PaymentStep` seam that Free leaves empty (`PAYMENT_FAILED`). The
  status graph and next-step rule live in `src/domain/booking-state.ts`.
- Booking status and cancel (`src/routes/booking.ts`, T049): `{ bookingRef, accessToken }` in the POST
  body; unknown ref and wrong token are the same `NOT_FOUND`. Cancel claims (`releaseClaimedAt`),
  releases seats, then moves to `cancelled`, then queues `cancel-<bookingId>`. Held bookings may always
  be abandoned; confirmed ones until `cancelCutoffHours` (setting, default 24) before the occurrence
  start (`src/domain/cancel-policy.ts`), else `CANCEL_NOT_ALLOWED`. Counters over the budget are left
  to drift repair. A cancel that takes over a stale claim (an earlier cancel died) releases nothing:
  drift repair settles the counters, so seats are never released twice (T057).
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
  `schedules.ts`): 1 KV read of `cron:scheduled:v1`; when missing, +1 to queue the one-shot `ensure-schedules`,
  whose tick schedules `sweep-holds` + `outbox-drain` and sets the flag. Never add it to checkout or admin
  actions. New recurring tasks go in `RECURRING_TASKS` (`src/plugin.ts`); bump the flag version.
- Waivers (Pro): `signature.mode` `each_attendee` (default) or `buyer`. The buyer signs inline for self
  and minors; other adults sign by email; check-in refuses attendees with a pending waiver.
- Registry installs give the core an `r_…` plugin ID, not the slug: the UI takes the ID as an option.
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
- UI (T054): `<EventList>` (also the `events-list` block) calls `public/events` through `callPublicRoute` with the
  integration's `pluginId` (virtual config module) and renders `<EventCard>`s, no client JS; states `ok`, `empty`,
  `error` (`data-state`). Time and price formatting is the pure `src/astro/lib/list.ts` (`cardView`,
  `listView`; shared `formatInZone`, unknown zone shows UTC). The `events-booking` block (`BookingBlock.astro`)
  takes an event entry id or slug (slug resolved with `getEmDashEntry`) and renders `<BookingWidget>`. `public/events`
  rows carry the entry `slug` (from `info.slug`), and list cards link to `/events/<slug>` by default (`hrefFor` overrides).
- Site content fields are snake_case (`starts_at`, `ends_at`, `timezone`, `venue`); plugin storage
  fields are camelCase.

## Where things live

`src/domain` pure logic (90% line coverage) · `src/routes` thin adapters · `src/storage/schema.ts`
collection names and shapes · `src/admin` Block Kit · `src/cron` jobs · `tests/` (vitest projects:
`core` in workerd, plus node projects for build checks).
