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
  to drift repair.
- Emails and calendar (`src/emails`, `src/routes/ics.ts`, `redeem.ts`, T050): outbox rows hold ids only;
  `outbox-drain` (every minute) runs the shared `drainOutbox` over an adapter (`OutboxDoc` ISO strings
  <-> `OutboxRecord` numbers) whose `email.send` renders at send time from fresh reads, one message
  per tick (8-9 calls). The link is `/booking?ref=&k=<one-time code>` (hash in `redeemHash`); the
  page POSTs it to `public/booking/redeem` for a fresh access token (R34). `public/booking` also
  returns `calendar.query` (`signLink`, `events/booking-ics`, 15 min, key in KV `events:link-key`) and
  valid attendees' `code` (R33). Event fields for emails/ICS come from `src/domain/event-info.ts`.
- Tokens never in URLs: booking access tokens travel in POST bodies; `callPublicRoute` refuses
  token-like keys on GET. Calendar files use short-lived signed links.
- Errors go through `toRouteError` from `@semics-tech/shared`. A wrong booking token is a 404.
- Deleting an event with bookings: `content:beforeDelete` returns exactly `false` (needs
  `content:read`); `afterDelete` marks the config orphaned as the backstop.
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
  (signed by the core, T050). Never use `set:html` or HTML sinks (a test checks).
- Site content fields are snake_case (`starts_at`, `ends_at`, `timezone`, `venue`); plugin storage
  fields are camelCase.

## Where things live

`src/domain` pure logic (90% line coverage) · `src/routes` thin adapters · `src/storage/schema.ts`
collection names and shapes · `src/admin` Block Kit · `src/cron` jobs · `tests/` (vitest projects:
`core` in workerd, plus node projects for build checks).
