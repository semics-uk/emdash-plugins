# Build plan: EmDash Events bookings + e-sign plugins

> Companion to [RESEARCH.md](./RESEARCH.md). Section references (§) point there.
> Target: `emdash >= 1.2.0`. Open core: the Free edition is MIT, published to the EmDash plugin
> registry and npm. A paid Pro edition of each core ships privately (§13).

---

## 1. Goals and non-goals

**Goals**
- A full-featured **Events bookings** plugin: ticket types, capacity, holds, free and paid (Stripe)
  checkout, custom questions, waitlist, check-in, emails, ICS, reporting, JSON-LD, MCP tools.
- A standalone **e-sign** plugin that is useful without Events: templates, envelopes, signing
  ceremony, audit trail, certificate of completion, and a generic signing-intent API.
- A **bundle** that wires them together so a booking can require a signed waiver/agreement.
- Registry-installable, sandboxed back ends wherever the platform allows.
- A **Free edition** that beats the existing free options (§11 of the research), and a **Pro
  edition** that earns money from the features organisations pay for (§13).

**Non-goals (v1)**
- Advanced/qualified e-signatures (AES/QES), certificate-based identity, or PKI signing of PDFs.
- Seat maps / reserved seating.
- A drag-and-drop PDF field designer (needs native React admin; revisit post-1.0).
- Multi-currency carts across events, or marketplaces / multi-vendor payouts.

## 2. Package architecture

Three published packages in one pnpm monorepo. Each of the two product packages carries **both**
its sandboxed core and its native front end, through separate entry points, so a site installs one
package per product. The front end can never come from the registry: Astro components and
Portable Text blocks are build-time code, which only native plugins can provide (research §2).

```
                ┌──────────────────────── site (Astro + emdash) ────────────────────────┐
                │                                                                       │
                │  @semics-tech/emdash-events                  @semics-tech/emdash-esign          │
                │  ┌────────────────────────────┐         ┌────────────────────────────┐│
 native entry → │  │ /ui  /astro  /client       │         │ /ui  /astro  /client       ││
 (no caps)      │  │ <BookingWidget> <EventList>│         │ <SigningCeremony> <Verify> ││
                │  └─────────┬──────────────────┘         └─────────┬──────────────────┘│
                │            │ SSR in-process, public routes        │                   │
                │  ┌─────────▼──────────────────┐         ┌─────────▼──────────────────┐│
 sandboxed    → │  │ /sandbox  semics-events    │◄─HMAC──►│ /sandbox  semics-esign     ││
 entry (also    │  │ storage, admin, cron, email│ intent/ │ templates, envelopes,      ││
 on registry)   │  │ Stripe*, MCP, JSON-LD      │ receipt │ audit chain, cert, MCP     ││
                │  └────────────────────────────┘         └────────────────────────────┘│
                │  @semics-tech/emdash-events-suite: eventsSuite(), <BookingWithWaiver>,     │
                │   pairing and reconciliation glue                                     │
                └───────────────────────────────────────────────────────────────────────┘
                 * Pro edition only
```

| # | Package | Entry points | Registry slug | Depends on |
|---|---|---|---|---|
| 1 | `packages/events` → `@semics-tech/emdash-events` | `.` (sandboxed descriptor `events()`), `./sandbox` (core bundle), `./ui` (native descriptor `eventsUi()`), `./astro`, `./client`, `./styles`, `./integration` | `semics-events` → `@<handle>/semics-events` | none |
| 2 | `packages/esign` → `@semics-tech/emdash-esign` | same shape: `esign()`, `./sandbox`, `./ui` (`esignUi()`), `./astro`, `./client`, `./styles`, `./integration` | `semics-esign` → `@<handle>/semics-esign` | none |
| 3 | `packages/events-suite` → `@semics-tech/emdash-events-suite` | `eventsSuite()`, `./astro` (`<BookingWithWaiver>`) | none (npm only) | 1, 2 |
| — | `packages/events-pro`, `packages/esign-pro` | Pro builds of the cores: `.` + `./sandbox` only, same plugin slug (§13) | none until the registry supports paid plugins | 1, 2 |
| — | `packages/shared` | internal lib, bundled into each core | — | — |
| — | `apps/playground` | Astro site for dev/E2E (Node + workerd runner) | — | all |

The first-party sandboxed plugins already publish this way on npm (`.` + `./sandbox` exports), and
the native `forms` plugin adds `./astro`, `./client` and `./styles`. Spike S10 confirms that
`emdash-plugin build` and the registry bundle accept native entry points in the same package.

**Install (one package per product, two config lines):**

```js
import events from "@semics-tech/emdash-events"; // generated sandboxed descriptor (an object)
import { eventsUi } from "@semics-tech/emdash-events/ui";

emdash({
  sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox", // Node; Cloudflare uses Worker Loader
  sandboxed: [events],
  plugins: [eventsUi()],
});
```

Registry-only installs get the back end, admin and public JSON API. The setup banner tells
operators that public pages need the npm package.

**Why it's still split inside the package:**
- The sandboxed core keeps the trust surface reviewable and installable from the admin.
- The UI entry has **zero capabilities**. It only renders, calling public routes in-process
  through `getPublicPluginApiRouteHandler`. A site can skip it and use the public JSON API.
- e-sign never imports anything from Events. The link between them is a documented protocol (§5).

> Slugs are prefixed (`semics-events`, `semics-esign`) because they're part of the route URLs,
> can't change after the first publish, and generic names like `events` are likely to collide with
> other publishers' plugins on one site.

### Repo layout

```
emdash-plugins/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, .changeset/, vitest.workspace.ts
  .github/workflows/{ci.yml, emdash-release.yml, npm-release.yml, pro-release.yml}
  packages/
    shared/        # hmac.ts, tokens.ts, licence.ts, money.ts, ics.ts, pdf-mini.ts, rrule-lite.ts, ratelimit.ts, blockkit helpers
    events/        # emdash-plugin.jsonc, src/plugin.ts (core), src/ui/ (descriptor), src/astro/, src/client/, src/styles/, tests/
    esign/         # same shape
    events-suite/
    events-pro/    # private: imports events' core + src/pro/*, same manifest slug, proprietary licence
    esign-pro/
  apps/playground/
  docs/            # protocol spec, operator guides, screenshots
```

The Pro packages live in a **separate private repo** that pulls the public packages as a dependency,
so the public repo stays wholly MIT. The tree above shows them for completeness.

## 3. Package specs

### 3.1 `semics-events` (sandboxed core of `@semics-tech/emdash-events`)

**Content model.** Events are ordinary EmDash content in a site-defined collection (default slug
`events`, configurable in settings). The plugin **cannot create collections** (§3.4), so we ship:
- a seed/schema snippet for the collection (`title`, `slug`, `body` PT, `starts_at`, `ends_at`,
  `timezone`, `venue`, `image`, `summary`) in `docs/` and in the playground;
- a settings field mapping (which field holds start/end/timezone/venue) validated via `schema:read`,
  with a Block Kit banner if the mapping is broken.

All booking-specific data lives in plugin storage, keyed by the content entry ID.

**Manifest (v1 trust contract)**
```jsonc
"capabilities": ["content:read", "schema:read", "email:send", "network:request"],
"allowedHosts": ["challenges.cloudflare.com"],              // Free edition
"allowedHosts": ["challenges.cloudflare.com", "api.stripe.com"], // Pro edition
```
The Free edition only talks to Turnstile. The Pro edition adds Stripe; switching from Free to Pro
is a new install, so its consent dialog shows the extra host once. Licences are verified offline
(§13), so neither edition contacts a licence server.
Deliberately **not** requested: `content:write` (too coarse) and `users:read` (not needed).
`hooks.content-policy:register` only covers `beforePublish/Schedule/Unpublish` policy hooks. We
don't need it: Spike S9 showed a delete veto needs only `content:read` (see Hooks).

**Storage collections**

| Collection | Key fields | Indexes |
|---|---|---|
| `eventConfigs` (id = entry ID) | status `draft/on_sale/paused/closed/cancelled`, capacity, `reserved`, `sold`, salesStart/End, currency, questions[], `signature: { required, templateId, mode: "each_attendee" \| "buyer" }`, waitlistEnabled, recurrence? | `status`, `salesEnd` |
| `occurrences` | eventId, startsAt, endsAt, capacity, reserved, sold, status | `["eventId","startsAt"]`, `startsAt`, `status` |
| `ticketTypes` | eventId, name, priceMinor, capacity, reserved, sold, min/maxPerOrder, salesStart/End, hidden (unlocked only by an `unlock` promo code), sort | `eventId` |
| `bookings` | ref, eventId, occurrenceId, status, holdExpiresAt, holdCeilingAt, buyer {name,email}, lines[], totals, payment {provider, ref}, answers, accessTokenHash, createdAt | `eventId`, `status`, `email`, `createdAt`, `["status","holdExpiresAt"]`, `["eventId","status"]`; unique `ref` |
| `payments` (id = `<provider>:<sessionId>`) | bookingId, provider, status, amountMinor, currency, refundedMinor, events[] | `bookingId`. The document id gives webhook idempotency, so no unique index on an optional booking field is needed |
| `attendees` | bookingId, eventId, occurrenceId, ticketTypeId, name, email, code, status, checkedInAt, signature {envelopeId, status, docSha256, pdfSha256, signedBy `self/guardian/buyer`} | `bookingId`, `eventId`, `email`, `["eventId","checkedInAt"]`; unique `code` |
| `waitlist` | eventId, occurrenceId, email, qty, status, offerExpiresAt, createdAt | `["eventId","status"]`, `offerExpiresAt` |
| `promoCodes` | code, eventId?, kind `percent/fixed/unlock`, amount, maxUses, uses, validFrom/To | `eventId`; unique `code` |
| `outbox` | kind, to, payload, attempts, nextAttemptAt, status | `["status","nextAttemptAt"]` |

**Booking state machine**
```
            ┌────────────► expired (hold TTL lapsed; cron releases inventory)
 draft ──► held ──► awaiting_signature ──► awaiting_payment ──► confirmed ──► cancelled / refunded
            └───────────────┴──── (steps skipped when not required) ──┘
```
- **Inventory:** each counted document (ticket type, occurrence, event) keeps one `reserved`
  counter (held + sold), because `updateIf` guards compare fields to **literal** values only. The
  guard field doesn't need an index.
  `updateIf(id, { where: { reserved: { lte: capacity - qty } }, delta: { reserved: { inc: qty } } })`,
  where `capacity` comes from the document just read. A miss means sold out.
  `sold` is a separate reporting counter, incremented on confirm. On expiry or cancel, `reserved` is decremented.
- **Multi-document reservation:** reserve in a fixed order (ticket types → occurrence → event). If
  any step misses, decrement the steps that already succeeded before returning "sold out". The
  `sweep-holds` cron also recomputes `reserved` from live bookings for recently touched documents,
  which repairs drift from crashed invocations.
- **Holds:** free checkouts default to 15 min. Paid checkouts default to **35 min**, because Stripe's
  `expires_at` must be 30 min–24 h after session creation. Each step advance (`checkout/continue`,
  `signatures/receipt`, session creation) extends `holdExpiresAt` up to `holdCeilingAt` (default
  60 min from the first hold). The cron `sweep-holds` runs every 5 min and processes a
  cursor-driven batch of ≤ N bookings per invocation (subrequest budget).
- **Waivers:** with `signature.mode = "each_attendee"` (default), every attendee gets their own
  envelope. The buyer signs inline during checkout, for themselves and as guardian for attendees
  marked under 18, and the booking confirms once those receipts are in. Nobody signs for another
  adult: other adult attendees get a signing email, their attendee record shows `waiver: pending`,
  and check-in is refused until they sign (staff can open the signing page at the door). This keeps
  seat holds short. With `mode = "buyer"`, the buyer signs once for the whole booking.
- `accessToken` = 32 random bytes, emailed as a link. Only its SHA-256 is stored. It gates the
  public booking status, ICS, cancel and ticket views. The email link points at the site's
  booking page (`/booking?t=…`), because SSR can't read URL fragments. That page sends
  `Referrer-Policy: no-referrer` and passes the token to the plugin in a POST body (in-process),
  never in a plugin route URL.

**Routes**

Public (`public: true`, all `methods`-restricted, Turnstile + KV rate-limit on writes):

| Route | Purpose |
|---|---|
| `GET public/events` | Upcoming bookable events (cached: `public, max-age=60, swr=300`) |
| `GET public/event` | One event's ticket types, availability, questions, price display |
| `POST public/checkout/reserve` | Turnstile + rate limit → validate → reserve inventory + create booking. Kept to the minimum number of bridge calls |
| `POST public/checkout/continue` | Write attendees, queue email → return `next`: `{ type: "sign", intents[] }` / `{ type: "pay", url }` / `{ type: "done", bookingRef }`. Idempotent; also used after signature or payment |
| `POST public/booking` | Booking status (access token in the body, not the URL) |
| `POST public/booking/cancel` | Self-service cancel within policy |
| `GET public/booking/ics` (raw `text/calendar`, `Content-Disposition: attachment; filename=booking.ics`) | Calendar file (short-lived signed link, not the access token) |
| `GET public/event/ics` (raw) | Event calendar file |
| `POST public/booking/redeem` | Exchanges the one-time code from the emailed booking link for a fresh access token (T050, R34) |
| `POST public/waitlist/join`, `POST public/waitlist/claim` | Waitlist |
| `POST webhooks/stripe` (`request.body: "text"`, header `stripe-signature`) | Payment confirmation; HMAC-verified |
| `POST signatures/receipt` | Accepts an e-sign **SignedReceipt** (§5), verifies HMAC |

Private (RBAC `content:read` for viewing, `plugins:manage` for config):
`admin` (Block Kit), `editor/booking-panel`, `events/config/get|save`, `tickets/*`, `bookings/list|get|cancel|refund|resend`,
`attendees/list|checkin|undo-checkin|export` (raw `text/csv`), `promo/*`, `waitlist/*`, `reports/summary`.
Route names use slashes only. The docs allow slashes and don't document dots.

**Hooks**
- `plugin:install`: default settings. `plugin:activate`: schedule crons
  (`sweep-holds` */5, `reminders` hourly, `outbox` */5, `retention` daily).
- `cron`: dispatch by name. Every job is cursor-based and resumable via KV.
- `page:metadata`: schema.org `Event` JSON-LD (`offers`, `availability`, `eventStatus`,
  `location`, `startDate` with offset) for entries in the events collection.
- `content:afterPublish` / `afterUnpublish` / `afterDelete`: sync `eventConfigs.status`.
- Deleting an event with confirmed bookings: veto it. Spike S9 (see §7) shows a sandboxed
  `content:beforeDelete` hook that returns exactly `false` blocks the delete (`DELETE_BLOCKED`) and
  needs only `content:read`, which the manifest already declares; without that capability the hook
  is silently skipped. Log the reason. Return `false`, never `{ cancel: true }` (ignored for this
  hook). The veto covers the trash action only; a permanent delete of an already trashed entry does
  not call `beforeDelete`, so `afterDelete` also marks the config `orphaned`, pauses sales, and
  shows an admin banner listing the affected bookings (the fallback). Don't block
  `beforeUnpublish`, because that needs `hooks.content-policy:register` and the warning banner is enough.

**Admin (Block Kit)**
- Pages (`group: "Events"` so they sit next to the events collection in the sidebar):
  **Bookings** (table + filters + actions), **Attendees / Check-in** (search by code/name, toggle
  check-in), **Waitlist** (not in 1.0, R68), **Promo codes**, **Settings** (collection mapping, hold TTL, currency,
  Stripe keys as `secret`, Turnstile keys, e-sign pairing string, email templates, retention days).
- Editor panel **"Tickets & booking"** on event entries: sale status, ticket-type `repeater`,
  capacity, questions `repeater`, waiver toggle + template select (`optionsRoute` → cached template
  list supplied via pairing), and live sold/held/remaining stats.
- Dashboard widget: upcoming events with sold/capacity meters, and a 30-day sales chart.

**Emails** (via an `outbox` collection plus a cron for retries; text + simple HTML): confirmation
(with links to the booking page, tickets and ICS), reminder (configurable offsets), event
update/cancellation broadcast, waitlist offer, refund notice. If no transport is installed, show
a banner and leave mail queued.

**MCP tools:** `listUpcomingEvents`, `getEventAvailability`, `findBooking`, `listAttendees`,
`checkInAttendee`, `cancelBooking` (`destructive`), `refundBooking` (`destructive`).

**Payments (Stripe, behind a `PaymentProvider` interface)**
- `createCheckout(booking)`: one `ctx.http.fetch` to Checkout Sessions with
  `client_reference_id = booking.id`, `expires_at = max(now + 30 min, holdExpiresAt)` (Stripe's
  minimum is 30 min after creation), and `metadata.bookingRef`. The hold is extended to the
  session's `expires_at`, plus 2 min of slack for webhook delivery.
- Webhook handles `checkout.session.completed` / `expired` and `charge.refunded`. Signature verified
  with WebCrypto HMAC-SHA256 + timestamp tolerance. It is idempotent because it writes the `payments`
  document with id `stripe:<sessionId>` using `compareAndSet`.
- **Late payment:** if `completed` arrives after the hold lapsed, try to re-reserve. If that
  succeeds, confirm the booking. If it's sold out, refund automatically, mark the booking
  `refunded_unavailable`, and email the buyer.
- Refunds: admin action → Stripe Refunds API → status `refunded`, inventory released.

### 3.2 `semics-esign` (sandboxed core of `@semics-tech/emdash-esign`)

**Manifest (v1)**
```jsonc
"capabilities": ["email:send", "media:read", "media:bytes:read", "network:request"],
"allowedHosts": ["challenges.cloudflare.com"],
```
(`media:*` is for PDF templates from Phase 6. Include it in the 1.0 contract so no major bump is
needed then, but drop it if PDF support slips past 1.0.)

**Storage collections**

| Collection | Key fields | Indexes |
|---|---|---|
| `templates` | name, kind `text/pdf`, body (Markdown + `{{field}}` placeholders), mediaId?, fields[], version, status, public (self-serve), sha256 | `status`, `public` |
| `envelopes` | title, templateId+version, status `draft/sent/in_progress/completed/declined/voided/expired`, routing `parallel/sequential`, clientId, externalRef, returnUrl, docSha256, expiresAt, completedAt, finalHash | `status`, `expiresAt`, `createdAt`, `["clientId","externalRef"]` |
| `signers` | envelopeId, order, role, name, email, status, tokenHash, otp {hash, expiresAt, attempts}, consentAt, signature {kind `typed/drawn`, typedName, strokes[]}, fieldValues, signedAt, ip, ua, geo, `piiSalt` | `envelopeId`, `email`; unique `tokenHash` |
| `artifacts` | envelopeId, kind `signed_pdf`, chunk index, data (base64), `pdfSha256` | `envelopeId` |
| `snapshots` | envelopeId, contentType, chunk index, data (base64 chunks if large), sha256 | `envelopeId` |
| `audit_events` | envelopeId, seq, type, at, actor, ip, ua, data, prevHash, hash | `["envelopeId","seq"]` |
| `clients` | name, clientId, createdAt, lastUsedAt, revokedAt (secret kept in an encrypted setting/KV; see Spike S8) | unique `clientId` |
| `nonces` (or KV with TTL sweep) | intent nonce, expiresAt | `expiresAt` |

**Signing ceremony (server side)**
1. `GET public/session?token=…` returns the minimal view model: rendered document snapshot
   (text/Markdown → sanitized HTML is built by **esign-ui**, never by a raw route), fields, signer
   name, consent text, and state.
2. Optional OTP: `POST public/otp/send` emails a 6-digit code. `POST public/otp/verify` checks it
   (attempt-limited).
3. `POST public/submit`: requires ESIGN consent, intent flag, typed name and/or stroke JSON, and
   field values. The server re-hashes the snapshot, binds `docSha256` to the signature, writes the
   audit event (hash-chained) and advances routing. On final signature it computes `finalHash`,
   marks the envelope complete, queues emails, and builds the receipt.
   The signed PDF (document + certificate) is generated **once**, at completion. It is stored in
   `artifacts`, and its `pdfSha256` goes into the receipt and the certificate. If generation
   exceeds the CPU budget, a one-shot cron finishes it.
4. `POST public/decline`. `GET public/download` (raw `application/pdf`, short-lived signed link)
   returns the stored PDF byte for byte. `POST public/verify` takes `{ sha256 }` and reports whether
   it matches a completed envelope's `pdfSha256` (no PII).
5. **Audit chain and retention:** audit events hash **salted commitments** of personal fields
   (`SHA256(piiSalt ‖ value)`), not the raw values. The retention job can then delete names,
   emails and IPs from `signers`/`audit_events` without breaking chain verification. Signed records
   (`artifacts`, the chain, commitments) have their own retention period, separate from booking
   data and longer by default.

**Public routes (complete v1 list, part of the trust contract):**

| Route | Purpose |
|---|---|
| `POST public/envelopes/from-intent` | Verify a SigningIntent (§5) → create or return the envelope → signing URL |
| `POST public/session` | Ceremony view model (signing token in the body) |
| `POST public/otp/send`, `POST public/otp/verify` | Email OTP |
| `POST public/submit` | Sign |
| `POST public/decline` | Decline |
| `GET public/download` (raw PDF) | Signed PDF via short-lived signed link |
| `POST public/verify` | Hash verification |
| `POST public/receipts/lookup` | Client-signed receipt lookup (§5) |
| `POST public/templates/catalog` | Client-signed template catalogue (§5) |
| `POST public/self-serve/start` | Start an envelope from a public self-serve template (Phase 6; declared now) |

**PDF strategy**
- Phase 1: `shared/pdf-mini.ts` is a dependency-free PDF writer (Helvetica standard font, text
  wrapping, vector paths for drawn signatures). It produces a document with the agreement text,
  signature blocks and the **certificate of completion** (audit table + hashes). It must fit in
  50 ms for typical waivers (≤ 5 pages). Benchmark in Spike S5.
- Phase 6: uploaded PDF templates. Stamp the fields onto the original PDF, either in-sandbox (if
  the `pdf-lib` cost is acceptable) or in **esign-ui** server-side (native, in-process, no CPU cap).
  In both cases the stored hash is computed by the sandboxed core. **Decided (T094, R53):** in the sandbox, with
  a minimal incremental-update writer instead of `pdf-lib`.

**Routes (private):** `admin`, `templates/*`, `envelopes/create|send|remind|void|get|list`,
`envelopes/audit` (raw CSV/JSON), `clients/create|revoke|list` (create returns the pairing string
exactly once).

**Hooks:** `plugin:activate` crons (`reminders` daily, `expire` hourly, `retention` daily,
`outbox` */5); `cron`.

**Admin (Block Kit):** Envelopes (table, status filter, detail with audit timeline, void/remind),
Templates (Markdown editor via multiline `text_input`, field `repeater`, preview), Integrations
(clients and pairing strings), Settings (sender name, consent wording, OTP on/off, reminder
cadence, expiry days, retention, Turnstile).

**MCP tools:** `listTemplates`, `sendForSignature`, `getEnvelopeStatus`, `remindSigners`,
`voidEnvelope` (`destructive`).

### 3.3 Events UI (the `./ui` and `./astro` entries of `@semics-tech/emdash-events`)

- Descriptor `eventsUi()`: `componentsEntry`, `portableTextBlocks` (`events-booking`,
  `events-list`), **no capabilities, no storage, no routes**.
- Astro components: `<EventList>`, `<EventCard>`, `<BookingWidget event={id}>`,
  `<BookingStatus>`, `<TicketPass>` (QR rendered client-side from the attendee code),
  `<AddToCalendar>`. All SSR-load via `getPublicPluginApiRouteHandler(Astro.locals)` (the `forms`
  pattern), with progressive enhancement from a small vanilla client script, and themed with
  CSS custom properties (`--events-*`).
- Works without JS: a plain `<form method="POST">` to the public checkout route, then redirect.
- Post-1.0 (optional): native React admin page "Scan tickets" with camera QR scanning, calling the
  private `attendees.checkin` route.

### 3.4 E-sign UI (the `./ui` and `./astro` entries of `@semics-tech/emdash-esign`)

- Descriptor `esignUi()`: `componentsEntry`, PT block `esign-request` (embed a **public
  self-serve template**, e.g. a consent form on a page).
- `<SigningCeremony token>`: renders the snapshot (Markdown → sanitized HTML), consent checkbox,
  typed signature, and a **signature pad** (pointer events → normalised stroke JSON, no raster),
  plus OTP step and decline. `<VerifyDocument>` handles hash-upload verification (the hash is
  computed client-side with WebCrypto; the file never leaves the browser).
- A page route recipe for sites (`/sign/[token].astro`) in the README, plus an Astro integration
  helper that injects it.

### 3.5 `events-suite` (bundle)

- `eventsSuite(options)` returns the `sandboxed` and `plugins` arrays to spread into `emdash()`.
  Operators get both cores and both UI kits in one import.
- `<BookingWithWaiver>`: orchestrates checkout → signing intent → `<SigningCeremony>` inline →
  receipt → payment, in one page flow, all SSR in-process.
- **Reconciliation:** when `<BookingStatus>` sees `awaiting_signature`, it calls e-sign
  `public/receipts/lookup` and forwards any receipt to events `signatures/receipt`. This covers
  signers who close the tab.
- Registry manifest-only listing (optional): a release whose `release.requires` names both package
  DIDs, so the registry shows them as a set.
- Pairing assist: a docs wizard. If Spike S2 allows it, add a one-click "Connect" flow in which the
  suite's admin page triggers client creation in esign and pastes the pairing into events.

## 4. Shared library (`packages/shared`, bundled into each core)

`hmac.ts` (sign/verify compact tokens, constant-time compare), `tokens.ts` (random opaque tokens +
SHA-256 storage), `money.ts` (minor units, currency formatting), `time.ts` (IANA timezone
handling via `Intl`), `ics.ts`, `rrule-lite.ts` (subset: DAILY/WEEKLY/MONTHLY, COUNT/UNTIL,
BYDAY, EXDATE; expand in bounded windows), `pdf-mini.ts`, `ratelimit.ts` (KV fixed-window by IP
hash), `turnstile.ts`, `blockkit.ts` (typed builders), `result.ts` (stable error codes).

## 5. Integration protocol (`esign-intent/1`)

Specify this formally in `docs/protocol/esign-intent-v1.md` with test vectors in `shared`.

- **Pairing string:** `esign1.<clientId>.<base64url secret (32 bytes)>`, created in the e-sign
  admin and pasted into the Events setting `esignPairing` (`secret` type).
- **Token format:** `base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, "<prefix>." + payloadB64))`,
  with a distinct prefix per token type: `esign-intent/1`, `esign-receipt/1`, `esign-lookup/1`,
  `esign-catalog/1`. A token of one type can never verify as another, even if a `typ` check is missed.
- **Token transport:** tokens never go in query strings. The receipt returns as
  `returnUrl#receipt=…`; the UI kit reads the fragment and POSTs it. UI kit pages send
  `Referrer-Policy: no-referrer`.
- **SigningIntent** (issued by the client, here Events):
  `{ v:1, typ:"intent", cid, tpl, tplVersion?, ref, signer:{name,email}, prefill:{}, returnUrl, exp (≤ 30 min), nonce }`.
  E-sign verifies the signature, `exp`, single-use `nonce`, that `returnUrl` matches a per-client
  allowlist (same-origin by default), and that the template exists. Duplicate `(cid, ref)` returns
  the existing envelope (idempotent).
- **SignedReceipt** (issued by e-sign):
  `{ v:1, typ:"receipt", cid, envelopeId, ref, status: "completed"|"declined"|"voided"|"expired", docSha256, pdfSha256, finalHash, at }`.
  Delivered via the `returnUrl#receipt=` redirect and via `public/receipts/lookup` (request signed
  by the client with `{cid, ref, ts}`).
- **`ref` for per-attendee waivers:** `<bookingRef>:<attendeeCode>`. The intent's `exp` is capped at
  the booking's remaining hold.
- **Normative spec:** `docs/protocol/esign-intent-v1.md` with 102 test vectors (T008, 2026-10-11). It
  refines this section: intents carry `iat` (enforcing the 30-minute cap and not-yet-valid checks);
  optional `as` (`self`, `guardian`, `buyer`), `participant` (for guardians) and `delivery`
  (`inline`, `email`) express the waiver rules; lookup and catalogue requests are
  `{v, typ, cid, ts[, ref]}` valid for 5 minutes; receipts never expire, and `pdfSha256` may be null
  while the PDF is still being generated; a `(cid, ref)` whose envelope was declined, voided or
  expired gets a new envelope. The spec's check order and error codes are binding on T012, T061,
  T062 and T064.
- **Events behaviour:** `signatures/receipt` verifies, matches `ref`→booking, stores
  `docSha256/finalHash/envelopeId`, and advances the state machine. It is idempotent.
- **Template catalogue for the Events editor panel:** `public/templates/catalog` (client-signed
  request) returns `{id, name, version}` for templates flagged "available to integrations". The
  Events admin caches the catalogue in KV after a manual "Refresh templates" action, which the
  suite calls in-process.

## 6. Phased delivery

Sizes: S ≈ ≤3 days, M ≈ 1–2 weeks, L ≈ 2–3 weeks (one developer). Each phase ends with the
playground demo and green CI.

| Phase | Scope | Size | Exit criteria |
|---|---|---|---|
| **0. Spikes & scaffolding** | Monorepo, CI, playground (Node + workerd and Cloudflare staging); run spikes S1–S8 | M | Spike findings written into RESEARCH.md §10; design adjusted |
| **1. E-sign MVP** | Text templates, single signer, typed + drawn, ESIGN consent, hash chain, certificate PDF (pdf-mini), emails, admin (Envelopes/Templates/Settings), `esign-ui` ceremony | L | Send → sign → download PDF on both runners; audit chain verifies; 50 ms budget met on CF staging |
| **2. Events MVP (free)** | Collection mapping, editor panel, ticket types, capacity + holds, checkout (free), access-token booking page, confirmation email, ICS, Bookings/Attendees admin, CSV export, JSON-LD, `events-ui` widget + list | L | 100 concurrent checkouts on staging never oversell; emails + ICS correct across time zones |
| **3. Integration + suite** | `esign-intent/1`, pairing, receipt route, `<BookingWithWaiver>`, reconciliation, `events-suite` | M | Waiver-required event cannot confirm without a valid receipt; tab-close path reconciles |
| **4. Payments** | Stripe Checkout, webhook, refunds, promo codes, fees/tax display | M | Stripe test-mode E2E incl. expired session releasing holds; webhook replay is idempotent |
| **5. Events advanced** | Custom questions, waitlist + offers, check-in UI + MCP tools, reminders, cancellation broadcasts, recurring events (rrule-lite), reports widget/charts, retention | L | Feature checklist §3.1 complete; MCP tools pass consent/permission tests |
| **6. E-sign advanced** | Multi-signer + sequential routing, OTP, reminders/expiry, decline/void, public self-serve templates (PT block), PDF templates (stamping per S5), bulk send | L | Multi-party contract E2E; PDF template E2E |
| **7. Hardening & 1.0** | Legal review of consent wording and retention defaults (D4), security review (public routes, token entropy, rate limits, CSRF assumptions), a11y + i18n of UI kits (RTL), docs sections, screenshots, registry listings, automated releases | M | `emdash-plugin validate` clean; delegated release publishes both cores; npm packages published |

MVP worth showing early is Phases 1–3 (free events with waivers). Phases 4–6 can run in parallel
after Phase 3.

Totals for one developer: about 7–11 weeks to the Phase 3 demo, and 12–20 weeks to 1.0, before
any re-planning after the spikes.

## 7. Spikes (Phase 0)

| ID | Question | Method | Fallback if negative |
|---|---|---|---|
| S1 | Do `ctx.storage/kv/content` bridge calls count toward **10 subrequests**? | Deploy a probe plugin to CF staging that loops storage gets and records the failure point | **Yes, every bridge call counts (T110).** Checkout is already split into `reserve` + `continue`; batching (`getMany/putMany`, one call each) and denormalised docs are mandatory, not a fallback |
| S2 | Does `getPublicPluginApiRouteHandler` reach **sandboxed** public routes? | Playground SSR component calling a sandboxed public route | UI kits call routes over `fetch(Astro.url.origin + …)` server-side |
| S3 | One-shot cron format, minimum interval, task limits | Read `core/src/plugins/cron.ts` + probe | Recurring 5-min sweeper only |
| S4 | Max storage document size | Probe writes of increasing size | Chunk snapshots/PDFs across docs, or `media:write`. **Adopted by design:** cap every document at 512 KiB; T110 measured about 8 MiB on real D1 and kept the cap (R24) |
| S5 | CPU of `pdf-mini` (5 pages + strokes) and of `pdf-lib` stamping | Benchmark in a Dynamic Worker | Render PDFs in `esign-ui` (native) and hash in core. **Not needed (T110):** a 5-page PDF with strokes plus SHA-256 is about 0.5 ms (R25) |
| S6 | Can a native UI-only plugin register PT blocks whose data is served by a sandboxed plugin? | Playground | Ship components for manual use in templates and drop PT blocks |
| S7 | Slug collision behaviour across publishers | Docs/registry source | Prefix slugs |
| S8 | Does `ctx.settings.set()` on a non-schema key encrypt? (dynamic client secrets) | Code read + probe | **Negative.** Decision (orchestrator, 2026-10-11): one declared secret field `integrationMasterKey`; each client's secret is derived as `HMAC-SHA256(masterKey, "esign-client/1." + clientId)`, so any number of clients works without dynamic secrets. Revocation is a flag on the `clients` document; rotating the master key re-pairs every client. A hash-only store can't work because HMAC verification needs the secret itself |
| S9 | Can a sandboxed `content:beforeDelete` hook veto a delete, and does it need a capability? | Runtime test host | `afterDelete` marks the config orphaned and shows an admin banner (already the default plan) |
| S10 | (a) Does `emdash-plugin build`/`bundle` accept native entry points (`./ui`, `./astro`) in the same package? (b) Does storage survive swapping the Free install for a Pro build with the same slug and publisher? | Scaffold + playground | (a) separate `-ui` packages again; (b) an export/import migration route |
| S11 | Is Ed25519 available in WebCrypto in the Dynamic Worker and in the Node runner, and how does a plugin learn the site's hostname? | Probe plugin | ECDSA P-256 keys; hostname from a required setting checked against `getPublicUrl()` |

**Resolved locally (2026-10-10, Phase 0):**
- **S10a confirmed.** One package can carry both halves. `emdash-plugin build`, `validate` and
  `bundle` accept extra `./ui` and `./astro` exports, and the registry bundle still contains only
  `backend.js`, `manifest.json` and the README. A playground site (Node, workerd runner) logs
  `Loaded sandboxed plugin semics-events:0.1.0`, mounts its routes, and compiles the UI entry's
  Astro component. The UI half is built with `tsc -p tsconfig.ui.json` after `emdash-plugin build`;
  Astro components ship as source under `src/astro`.
- **S11 confirmed.** Ed25519 sign and verify work through WebCrypto inside the sandbox (Worker
  Loader test host); a tampered message fails. `ctx.site.url` is always available for the hostname
  check. 200 SHA-256 digests of 1 KiB took about 1 ms.
- **S2 confirmed: direct in-process works; no fallback needed on the Node workerd runner (T004).**
  `getPublicPluginApiRouteHandler(Astro.locals)` dispatches to sandboxed plugins. The handler is
  `createPublicPluginApiRouteHandler(runtime)`, which `emdash/astro` middleware puts on
  `locals.emdash` for every page request, anonymous visitors included. It reads
  `runtime.getPluginRouteMeta()`, which covers build-time sandboxed entries through the manifest
  route cache, and returns `NOT_FOUND` unless the route is declared `public: true`. It then calls
  `runtime.handlePluginApiRoute()`. That runs the same method check (405) and declared-body
  parsing as the HTTP route, then goes to `handleSandboxedRoute` for sandboxed plugins. Evidence:
  playground on `@emdash-cms/sandbox-workerd` (`Loaded sandboxed plugin semics-events:0.1.0`).
  A temporary probe route `public/probe` was declared `{ public: true, methods: ["POST"],
  request: { body: "json" } }`. A page called it via `callPublicRoute(Astro, { method: "POST",
  path: "public/probe", body: { ping: "s2" } })` and server-rendered `{ pluginId:
  "semics-events", method: "POST", echo: { ping: "s2" } }`, marked `via: "in-process"`. That is
  about 140–250 ms cold and 2–7 ms warm per page. Playwright passes with JavaScript disabled. The
  same page gives a defined error state (`NOT_FOUND`), not a crash, in four cases: an unknown
  plugin ID; the private `hello` route (the public handler refuses it); an undeclared route; and
  the plugin truly disabled (`_plugin_state.status = 'inactive'`, then a server restart). Over
  HTTP the probe returns 200 for POST and 405 for GET, `hello` returns 401 unauthenticated, and
  every route returns 404 once the plugin is disabled. Decision: UI code calls the core only
  through `packages/events/src/astro/lib/call.ts` `callPublicRoute()`. It returns `{ ok, data |
  error, via }` and never throws. It falls back to `fetch(Astro.url.origin + "/_emdash/api/plugins/…")`
  only when the handler is missing from `locals`, which happens when runtime init failed or the
  middleware didn't run. Cloudflare (Worker Loader) uses the same code path; T110 confirms it on
  staging. The probe route has been removed. Note for e2e: the workerd runner binds fixed ports
  from 18788. A leftover `workerd` process holding them makes the next server fail with
  `bind(): Address already in use`, so two playground servers can't run at once.
- **S10b confirmed (T071, 2026-10-22).** Storage survives swapping Free for Pro and back. Run on the
  EmDash runtime test host (`@emdash-cms/plugin-test` 0.2.8, emdash 1.2.0, local D1), not the
  playground, because installing Pro there would put Pro into this repo (R40). The Pro repo's edition
  tests load the real Free and Pro builds in turn over one database, each as a fresh EmDash runtime
  and isolate: Events event configs, ticket types, occurrences and settings, and E-sign template
  versions and settings, written on Free are read and updated on Pro, and everything written on
  either is read again on Free. Plugin rows are keyed by the manifest slug, so the same slug and
  publisher is all continuity needs; the Pro manifest is generated from Free's plus additions only.
  The Free bundle has none of the Pro-only routes (`pro/licence`); after a downgrade they are simply
  "Route not found". Caveat found: EmDash caches loaded sandboxed plugins in module scope by
  `<slug>:<version>`, which Free and Pro share, so in one long-lived process the swap only takes
  effect after a restart (which every deploy is); the test helper stops the running site first.
- **T005 probes (2026-10-11).** Run in the Worker Loader + local D1 test hosts (`@emdash-cms/plugin-test`
  0.2.8, emdash 1.2.0), so numbers that depend on D1 are local; T110 re-measures on Cloudflare.
  Evidence: `packages/events/tests/probes/README.md`, probes at commit `2b5249d`.
  - **S3 confirmed.** `ctx.cron.schedule(name, { schedule, data })` takes either a cron expression
    (5-field, 6-field with seconds, or `@daily`-style aliases; evaluated in UTC) or a one-shot ISO 8601
    datetime (`2026-10-11T11:13:45Z`; a datetime without a zone is read as UTC; a past datetime fires on
    the next tick). The `cron` hook needs no capability. A one-shot fires exactly once and its row is
    then deleted; a second tick processes 0. A failing one-shot is retried with backoff (1 min doubling,
    5 retries) and then dropped. The task key is `(plugin, name)` and a second `schedule()` with the same
    name replaces the pending task, so per-booking tasks need a unique name (letters, digits, `-`, `_`,
    starts with a letter, max 128 chars; a space is rejected). Each tick claims at most **10** due tasks
    (12 due tasks took two ticks: 10 then 2). A one-shot fires on the first platform tick after its time, so
    precision is the tick interval, not the schedule's resolution (the interval itself is set by the
    host's scheduler; T110 measures it on Cloudflare). Decision: hold expiry may use one-shot
    tasks named `hold-<ref>`, but `sweep-holds` (recurring, */5) stays the source of truth because one
    task per hold is capped at 10 per tick; one-shots are only an accelerator.
  - **S4 passed locally; design cap set anyway.** Documents of 64 KiB, 512 KiB, 1 MiB, 2 MiB and 4 MiB
    round-trip; 8 MiB fails with `D1_ERROR: string or blob too big: SQLITE_TOOBIG`. Bisected: largest ok
    8,323,072 bytes of payload (about 8.0 MiB of JSON), failure at 8,388,608. The limit is on the
    serialised JSON string (the failing size is the JSON length, not the field count). The local SQLite
    limit is far above Cloudflare D1's documented 2 MB row limit, so it must not be trusted for
    production. Decision: keep every storage document at or below 512 KiB (chunk `artifacts` and
    `snapshots` at 256 KiB base64 chunks as already planned) until T110 re-runs this probe on staging.
  - **S8 negative.** With `EMDASH_ENCRYPTION_KEY` set, a `secret` field in `admin.settingsSchema` is
    stored as an `{ $emdash: "plugin-setting", v, kid, iv, ciphertext }` envelope, both through
    `actions.plugin.updateSettings()` and through `ctx.settings.set("apiKey", …)` from the sandbox
    (which `get` decrypts). `ctx.settings.set("client:abc:secret", "…")` on a key outside the schema
    stores the **plaintext** (source: `encodePluginSettingValue` returns the value unchanged unless the
    key is a declared secret field). Without `EMDASH_ENCRYPTION_KEY`, saving a secret fails with
    `PLUGIN_SETTING_ENCRYPTION_KEY_MISSING`, so the plugin must show a banner when the key is absent.
    Decision: no dynamically named secrets; client secrets are derived from one declared master key
    (see the S8 row in the spike table).
  - **S9 confirmed: delete can be vetoed, with limits.** A `content:beforeDelete` hook that returns
    exactly `false` makes the trash action fail with `DELETE_BLOCKED` ("Delete blocked by plugin hook")
    and the entry stays. Returning `{ cancel: true, reason }` does **not** block (the runtime tests
    `result === false`; the probe's trash succeeded). The hook needs the `content:read` capability and
    nothing else (not `hooks.content-policy:register`); a plugin with `capabilities: []` has the
    hook silently skipped (`afterDelete` also does not fire). A permanent delete of an already trashed
    entry does not run `beforeDelete`, only `afterDelete`. Decision: veto on trash when the event has
    confirmed bookings, plus the `afterDelete` orphan banner as the backstop (§3.1 Hooks).
  - **S7 resolved from source: no slug collision across publishers.** Registry installs key a plugin by
    `r_` + base32(SHA-256(`<publisher DID>\n<slug>`))[0..16] (`makeRegistryPluginId`), so `events` from
    two publishers get different ids (probe: `r_gnv5d4…` vs `r_z2erd5…`). That id, not the slug, is
    `ctx.plugin.id`, the route URL segment and the storage/settings/cron namespace for registry
    installs. A configured (non-registry) plugin keeps its manifest id as is. Installing a registry
    plugin whose derived id already exists fails with `ALREADY_INSTALLED`, `PLUGIN_ID_COLLISION` or
    `PLUGIN_ID_CONFLICT`, never merges. Two plugins registered in config with the same id throw
    `Plugin "<id>" is already registered`. Not probed in a host (the test hosts load one plugin).
    Decision: no slug prefix is needed. Code must never hard-code `semics-events` as a plugin id: read
    it from `ctx.plugin.id` or the route URL (affects T004's UI call path, the suite wiring and
    the e-sign pairing).
- **S6 confirmed (T006): a native UI-only plugin registers a Portable Text block that the site renders; no fallback needed.**
  `createPlugin()` in `packages/events/src/ui/index.ts` calls `definePlugin({ admin: { portableTextBlocks:
  [{ type: "events-list", label, fields: [text_input heading, number_input limit] }] } })`, the same
  shape the first-party forms plugin uses. `blockComponents["events-list"]` in `src/astro/index.js`
  is auto-merged into `<PortableText>`, so a seeded page whose body holds `{ "_type": "events-list" }`
  renders `EventList.astro` (given the block as `Astro.props.node`) with no change to the page
  template. Playwright with JavaScript disabled passes (`apps/playground/e2e/s6-pt-block.spec.ts`,
  `/whats-on`). The editor configuration passes `validateBlocks` from `@emdash-cms/blocks/server`
  (the validator emdash uses for Block Kit) as a form block, and a bad element type is rejected.
  `createPluginRuntimeTestHost()` cannot be used for this: it takes only site and i18n options and
  loads the built sandboxed plugin, never a native descriptor. Block data is static for now; the
  core serves it from T046's public events route. `emdash-plugin build` is unaffected because the
  blocks live only in the UI entry (the registry bundle's manifest still has no
  `portableTextBlocks`). The block data is not served by the core yet, so the "data from the
  sandboxed core" half is covered by S2 (`callPublicRoute`) plus T046; the PRDs keep the blocks.

**Measured on Cloudflare (T110, 2026-10-21).** Probe Workers on the owner's Workers Paid account
(`spikes/cloudflare`, raw numbers in `spikes/cloudflare/results/`). The host Worker runs the probe in a
Worker Loader isolate the way `@emdash-cms/cloudflare` 1.2.0 runs a sandboxed plugin: a fresh loopback
bridge binding per request (`ctx.exports.ProbeBridge({ props })`, same SQL as `PluginBridge`),
`globalOutbound: null`, `limits: { cpuMs: 50, subRequests: 10 }` (EmDash's defaults), D1 in WEUR. Every
`semics-probe-*` resource was deleted afterwards. The playground itself was not deployed (see T110 notes).
- **S1 confirmed: every bridge call is one subrequest; the 11th throws (EV-NFR-01).** A no-op RPC,
  a D1-backed `storageGet` and a `kvGet` each complete 10 calls and the 11th rejects with `Too many
  subrequests by single Worker invocation`; the same for 40 calls in parallel (10 succeed). The D1 query
  inside the bridge is not charged to the plugin (the no-op fails at the same point). An outbound
  `fetch` counts the same way. `storageGetMany` of 40 ids is one call. The error is catchable, so a
  route can still answer. With no `limits` passed, 40 calls succeed, so the cap is EmDash's
  `subRequests: 10`, not a platform default. Stable across repeated requests on a cached isolate, and
  inside `scheduled()` (every cron tick also stopped at 11).
- **S4: real D1 stores about 8 MiB per document; the 512 KiB cap stays.** `storagePut` round-trips
  64 KiB to 4 MiB; 8 MiB fails with `D1_ERROR: string or blob too big: SQLITE_TOOBIG`. Bisected: largest
  payload stored 8,388,544 bytes, failure at 8,388,560 (JSON adds 11 bytes, the row a few dozen), i.e.
  the same ~8 MiB row limit as local SQLite, not the 2 MB in Cloudflare's docs. 32 MiB fails earlier on
  the RPC cap (`Serialized RPC arguments … limited to 32MiB`). Decision R24.
- **Unique indexes are enforced on real D1.** With EmDash's exact DDL (`CREATE UNIQUE INDEX
  uidx_plugin_<id>_<coll>_<field> ON _plugin_storage(plugin_id, collection, json_extract(data, '$.<field>'))`)
  and its put SQL (`ON CONFLICT (plugin_id, collection, id) DO UPDATE`), a second document with the same
  value under a different id fails with `D1_ERROR: UNIQUE constraint failed: index 'uidx_…':
  SQLITE_CONSTRAINT`; updating the same id is fine; documents with the field missing or `null` never
  collide; comparison is case-sensitive; the same value in another collection is fine; a `batch()`
  containing a violating insert rolls back entirely. The in-memory test host does not enforce this.
  Decision R26.
- **S5 confirmed: PDFs fit in the core (EV-NFR-02).** Probe stand-in for the T016 writer (Helvetica
  text, 60 lines a page, 6 strokes x 120 points, SHA-256 of the output) vs `pdf-lib` 1.17.1 (523 KB
  bundle). Workers clocks only move on I/O, so CPU was read three ways: renders that fit under
  `cpuMs: 50`, timings bracketed by no-op bridge calls, and sustained pass rates (20 runs each):

  | Workload (warm isolate) | Cloudflare, per render | Node 24 `process.cpuUsage` (M-series) |
  |---|---|---|
  | pdf-mini 1 / 3 / 5 pages + SHA-256 | about 0.1 / 0.2 / 0.5 ms (5 pages x 100 in one invocation: 15/20 pass) | 0.58 / 0.57 / 0.87 ms |
  | pdf-mini 5 pages, FlateDecode | about 0.7 ms (71 fit) | 2.7 ms |
  | pdf-lib create 1 / 3 / 5 pages | about 0.4 / 1.5 / 3 ms; one 5-page create 20/20 | 4.3 / 5.7 / 11.3 ms |
  | pdf-lib stamp strokes on 1 / 3 / 5 pages | about 3–9 ms; x4 20/20, x10 2/20, x30 0/20 | 17.1 / 13.2 / 12.4 ms |

  A cold isolate (pdf-lib module parse included) also passed one render under 50 ms. **`cpuMs` is not a
  hard per-invocation cut-off:** an isolate that has been idle or cheap can burst well past it (40
  five-page stamps passed under `cpuMs: 50` and even `cpuMs: 5`; 160 failed with `Worker exceeded CPU
  time limit.`; with `cpuMs: 1000` 160 passed), while back-to-back heavy calls are held close to 50 ms
  (x10 stamps: 2/20). Design to 50 ms sustained and never rely on the burst. **Local CPU vs Cloudflare:**
  Node's `process.cpuUsage()` on the dev machine reads 1.5–4x *higher* than Cloudflare for the same
  workload (it also counts V8's GC and compiler threads), so the T007 harness's local CPU figure is a
  conservative over-estimate and a local 50 ms ceiling is safe. Decisions R25, R27.
- **Cron tick (Cloudflare `* * * * *`, the trigger `emdash doctor` recommends).** Plugin cron on
  Cloudflare runs only from the site's Cron Trigger (`scheduled()` → `runScheduledTasks()` →
  `cronExecutor.tick()`), so the tick interval is the trigger's. Measured: the trigger started firing
  about 9 minutes after the first deploy (propagation); then 6 ticks exactly 60,000 ms apart by
  `scheduledTime`, which sat at a fixed offset inside the minute (`hh:mm:51.757`, not `:00`), and the
  handler started 0.9–2.4 s after `scheduledTime` (13.2 s on the first tick). No missed or doubled
  ticks in that window (a short sample; a nightly run would widen it). So a one-shot task fires up to
  about 62 s after its time, and the first tick after a deploy can be minutes late. Decision R23.
- **S2 on Worker Loader (T111, local workerd, 2026-10-22).** The playground's Cloudflare build (Astro
  Cloudflare adapter 14.3.4, `@emdash-cms/cloudflare` 1.2.0 `sandbox()`, D1, R2, `env.staging` of
  `apps/playground/wrangler.jsonc`) served by `wrangler dev` loads both cores through the `LOADER` binding,
  and `/spike/s2` renders `public/events` with `via: "in-process"`: `getPublicPluginApiRouteHandler` reaches
  Worker Loader plugins exactly as on the Node workerd runner, so S2 holds on Cloudflare's runner too. The
  same build passes the staging smoke suite, a real Events Pro check-in (R54), the visitor-IP check (the
  booking's `ipHash` is not the shared "unknown") and the 100-buyer race on (local) D1: 5 booked, no
  oversell. Worker upload: 20.3 MiB, 5.2 MiB gzip (under the 10 MiB paid limit). `wrangler deploy
  --dry-run` passes. Decisions R80–R83.
- **Not measured yet:** the same on the live account (the nightly `.github/workflows/staging.yml` waits
  for the owner's CI token, T111 notes), Cloudflare's CPU figure next to T007's (R27), and the R53 PDF
  CPU at the 3 MiB cap. Cron was sampled for 6 ticks only.

**Resolved from docs (2026-10-09):**
- `updateIf` guard fields don't need declared indexes, and guards compare against literal values
  only. Hence the single `reserved` counter.
- `hooks.content-policy:register` covers `beforePublish/Schedule/Unpublish` policy hooks only.
  The docs don't mention delete vetoes, hence S9.
- Route names may contain slashes. Dots aren't documented, so route names use slashes only.
- Unique-index behaviour for missing values isn't documented. The design avoids relying on it
  (the `payments` collection is keyed by id).
- Stripe Checkout `expires_at` must be 30 min–24 h after creation.

**Resolved from the EmDash sources (2026-10-22, T118): the 128 KiB bundle limit.**
- **Source.** It is the registry bundle format's per-file cap (RFC 0001: at most 128 KiB per file,
  256 KiB in total, 20 files). Two copies enforce it:
  - `@emdash-cms/plugin-cli@0.13.3`, `dist/index.mjs:869` (`src/bundle/utils.ts`):
    `MAX_FILE_SIZE = 128 * 1024`, checked by `validateBundleSize` (`:1070`), which `bundlePlugin`
    runs (`:3248`) for both `emdash-plugin bundle` and `emdash-plugin validate`. The same cap guards
    release files (`MAX_RELEASE_FILE_BYTES`, `:8247`).
  - `@emdash-cms/registry-verification@0.3.4`, `dist/bundle.js:11` and `:145`
    (`MAX_BUNDLE_FILE_BYTES`, error `BUNDLE_FILE_SIZE_EXCEEDED`), called by `emdash@1.2.0`
    `src/registry/artifact-verification.ts:42` when a site installs or updates a plugin from the
    registry (`src/api/handlers/registry.ts:874`, `:1545`).
- **Scope.** Registry bundles only. A config-declared install (`sandboxed: [...]`, from npm or a
  path) is read by `generateSandboxedPluginsModule` (`emdash` `src/astro/integration/virtual-modules.ts:660`,
  `readFileSync` and embed, no size check), and neither sandbox runner (`@emdash-cms/cloudflare`
  Worker Loader, `@emdash-cms/sandbox-workerd`) checks code size. The loader takes one module per
  plugin, so splitting the backend into several files is not an option.
- **Applies to Pro anyway.** Pro builds run `emdash-plugin validate` and should stay publishable to
  the registry when it takes paid plugins, so every build keeps the cap. Budget (R42): each
  `backend.js` at most 104 KiB (24 KiB under the cap), asserted by `tests/bundle-size.build.test.ts`
  in both cores (`@semics-tech/shared/testing/bundle-size`) and by the Pro build suite.

## 8. Testing strategy

- **Unit** (`shared`): HMAC test vectors, rrule expansion, ICS output, money rounding,
  pdf-mini output validated with an external parser in CI (`qpdf --check`).
- **Plugin host** (`createPluginTestHost`): every route and hook, storage invariants, capability
  denial (e.g. `ctx.http` to an unlisted host throws), fake Stripe/Turnstile via `host.http.respond()`.
- **Runtime host** (`createPluginRuntimeTestHost`): route auth/permission/CSRF, public route
  exposure, editor panel load/actions, cron scheduling, content hooks with real entries, MCP
  registration.
- **Concurrency:** property tests hammering `checkout/reserve` with parallel requests against D1,
  including injected failures between multi-document steps. The invariants `reserved ≤ capacity`
  and `reserved = Σ live bookings` (after a sweep) always hold.
- **Payments:** a late `checkout.session.completed` after the hold lapsed, in both the re-reserve
  and the auto-refund paths.
- **E-sign:** the downloaded PDF's SHA-256 equals `pdfSha256`. The audit chain still verifies after
  the retention purge.
- **E2E** (Playwright, `apps/playground`): booking, booking with waiver, paid booking (Stripe test
  mode), signing ceremony with pad input, admin flows. Run on Node/workerd in CI. A nightly job
  against a Cloudflare staging deploy catches CPU/subrequest limits.
- **Security:** token brute-force resistance (rate limits), receipt forgery/replay tests, open-redirect
  tests on `returnUrl`, and XSS tests on rendered template Markdown.

## 9. Release & open-source process

- Pro builds: a private repo and a `pro-release.yml` workflow publish `@semics-tech/emdash-events-pro`
  and `@semics-tech/emdash-esign-pro` to a private npm registry, versioned in lockstep with Free (§13).
- Public GitHub repo (required for delegated releases), MIT license, `SECURITY.md` with a contact
  (also required in each manifest), CONTRIBUTING, issue templates.
- **Changesets** for versioning. `emdash-plugin release setup` generates `emdash-release.yml`,
  which is wired to Changesets outputs so sandboxed packages go to the registry with Sigstore
  provenance. A separate npm publish job (with provenance) handles the native packages.
- `publisher` pinned to the org's **DID** in both manifests. `release.requires` sets
  `env:emdash: ">=1.2.0 <2"`.
- Registry listing per core: `sections` (description, installation including the "create the events
  collection" step and email-transport prerequisite, FAQ, security), icon, banner, and screenshots of
  the admin pages and the booking/signing UI.
- Versioning discipline: 0.x until Phase 7. Freeze the **trust contract** at 1.0. Any later
  capability, host, public route or MCP tool addition is a major version (re-consent).

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Bridge calls count as subrequests (S1) | Checkout may need >10 host calls | Batched APIs, denormalised `eventConfigs`, split steps; measure every route in CI with a call counter wrapper |
| 50 ms CPU on Cloudflare | PDF/recurrence work fails in production only | Budget tests on staging; offload PDF stamping to native UI layer; bounded batches |
| Plugins can't create the `events` collection | Setup friction | Seed snippet, admin banner with exact instructions, playground/template starter |
| No email attachments / transport may be missing | Tickets and PDFs not delivered | Link-based delivery; outbox retries; admin banner |
| E-signature legal exposure | Misleading compliance claims | SES-only positioning, consent capture, audit chain, counsel-reviewed wording, clear disclaimer |
| Public routes abuse (spam bookings, token guessing) | Inventory exhaustion, data leakage | Turnstile, KV rate limits, hold TTLs, 256-bit tokens, minimal responses |
| Trust-contract churn | Re-consent friction for operators | Declare v1 capabilities deliberately; freeze at 1.0 |
| EmDash API drift (young platform, 1.x) | Breakage | Pin `env:emdash` ranges, track releases, CI against `emdash@latest` weekly |
| Cloudflare sandbox needs Workers Paid | Free-plan users can't sandbox | Document npm `plugins: []` in-process fallback (with trust caveat) |

## 11. Immediate next steps

0. The owner completes the one-time checklist in the management plan (accounts, payment and
   legal steps). Everything below is done by the management agent.
1. Secure the `semics` names: the npm scope `@semics`, the GitHub org and the Atmosphere publisher
   handle (record its DID). Then create the public repo, pnpm workspace, CI and Changesets.
   Set up the Cloudflare Workers Paid staging account.
2. Scaffold `packages/events` and `packages/esign` with `pnpm dlx @emdash-cms/plugin-cli init`.
   Scaffold `apps/playground` from an EmDash Node template with the workerd sandbox runner.
3. Run spikes S1, S2 and S5 first; they decide the shape of checkout and PDF generation.
4. Write `docs/protocol/esign-intent-v1.md` with test vectors before building Phase 1, so both
   cores code against the same contract.

## 12. Decision log

### Decided (2026-10-09 review)

| # | Decision | Basis |
|---|---|---|
| R1 | Paid holds default to 35 min; holds extend on each step, up to a 60-min ceiling | Stripe `expires_at` minimum is 30 min |
| R2 | Late Stripe payment → re-reserve, or auto-refund if sold out | Otherwise money is taken for seats that were released |
| R3 | One `reserved` counter per counted document; compensate on partial failure; the sweeper repairs drift | `updateIf` guards compare literals only; no multi-document transactions |
| R4 | Every e-sign public route is listed in the v1 contract | Adding a public route later forces re-consent |
| R5 | Waivers: per-event `signature.mode`, default `each_attendee`; buyer signs inline for self and minors; other adults sign by email, and check-in is blocked until they do | Event waivers bind each participant; nobody can sign for another adult; holds can't wait days |
| R6 | Signed PDF built once at completion; `pdfSha256` verified against the stored bytes | On-demand PDFs aren't byte-identical, so verification would fail |
| R7 | Audit chain hashes salted commitments of personal data; separate retention for signed records | Lets the retention purge run without breaking the evidence |
| R8 | `payments` collection keyed by `<provider>:<sessionId>`; no unique index on an optional field | Unique-index behaviour for missing values is undocumented |
| R9 | Checkout split into `reserve` + `continue` from the start | The estimated call count is already at the 10-subrequest limit |
| R10 | Distinct HMAC prefix per token type; no tokens in plugin route URLs; `Referrer-Policy: no-referrer` | Prevents token-type confusion and leaks through logs and referrers |
| R11 | Hidden tickets unlocked only by `unlock` promo codes (`unlockCode` removed) | One mechanism, with usage limits and validity windows |
| R12 | Route names use slashes only | Dots aren't documented as valid |
| R13 | Event delete protection: veto trash by returning `false` from `content:beforeDelete` (S9: works, needs only `content:read`), plus orphan + banner for permanent deletes; no `content-policy` capability | Keeps the trust contract minimal |
| R14 | Prefixed slugs `semics-events` / `semics-esign` | Irreversible after the first publish; avoids collisions |
| R15 | Three packages: `@semics-tech/emdash-events` and `@semics-tech/emdash-esign` each carry core + UI through separate entry points; the suite stays separate | One install per product; the registry can't deliver UI anyway (2026-10-10) |
| R16 | Open core: Free edition MIT on the registry; Pro edition as a superset build of the same slug, delivered by private npm | Plugins can't share storage, so Pro can't be a separate add-on plugin (2026-10-10) |
| R17 | Offline Ed25519 licence keys bound to site hostnames, with a perpetual fallback for builds before `updatesUntil` | No licence-server host in the trust contract; works on Node and Cloudflare (2026-10-10) |
| R18 | Free/Pro split per §13: paid tickets, promo codes, questions, waivers, QR check-in, reminders, reports, MCP and multi-party/high-volume signing are Pro; security, privacy, legal evidence and export are always free | Free must beat Dateline and Eventual; Pro covers what earns money or saves staff time (2026-10-10) |
| R19 | Free Events manifest drops `api.stripe.com`; Pro adds it | Keeps the Free trust contract minimal (2026-10-10) |
| R20 | Toolchain: Node 24.21.0 pinned per project (`.nvmrc`, pnpm `use-node-version`), pnpm 10.23, EmDash 1.2.0, plugin CLI 0.13.3 | `@emdash-cms/registry-verification` needs Node 24.15 or newer (2026-10-10) |
| R21 | Publisher is a domain handle; manifests carried a placeholder DID until the handle resolved (superseded by R86) | `emdash-plugin init` resolves handles online; the real DID replaces the placeholder before the first publish (2026-10-10). R86 names the real handle and DID |
| R22 | Every bridge call is one subrequest and a sandboxed invocation (route, hook or cron tick) gets exactly 10; `getMany`/`putMany` are one each. Designs target ≤ 8 calls so a log or email call never tips a route over, and the T007 harness keeps asserting ≤ 10 as the real limit, not a proxy | T110 S1: the 11th call throws, in parallel too, inside `scheduled()` too (2026-10-21) |
| R23 | Cron precision is the site's one-minute Cron Trigger plus 1–3 s: one-shots may fire up to ~62 s late and the first tick after a deploy can be minutes late, so hold expiry stays on the `*/5` sweeper with one-shots as an accelerator (S3 decision unchanged); each sweeper tick does a cursor batch within 10 calls | T110 cron tick (2026-10-21) |
| R24 | Keep the 512 KiB per-document cap and the 256 KiB chunking of `artifacts`/`snapshots` | Real D1 takes ~8 MiB, but the docs promise 2 MB and parsing large JSON costs sandbox CPU (2026-10-21) |
| R25 | Signed PDFs are rendered and hashed in the sandboxed core with the T016 writer; the `esign-ui` fallback is dropped. `pdf-lib` stays out of the Free core (523 KB bundle); Pro uploaded-PDF stamping (T094) may use it at most one stamp per invocation, budgeted in tests (superseded by R53: T094 writes its own incremental update) | T110 S5: ~0.5 ms for 5 pages + strokes + SHA-256; pdf-lib stamp 3–9 ms, x10 fails sustained (2026-10-21) |
| R26 | `uniqueIndexes` may be relied on for duplicate prevention: D1 rejects a duplicate with `UNIQUE constraint failed: index 'uidx_…'`, which the core maps to a stable error code. Missing/`null` fields never collide, values are case-sensitive (normalise before storing). Tests fake the rejection because the in-memory test host doesn't enforce unique indexes | T110 unique-index probe on real D1 (2026-10-21) |
| R27 | The T007 CPU ceiling stays 50 ms measured locally; Node `process.cpuUsage()` over-estimates Cloudflare CPU 1.5–4x, so it is conservative. T007's harness (built in parallel) measures sandbox wall time minus bridge waits because workerd has no CPU clock; that also over-estimates, but T111 should confirm it against a staging route. Never rely on Cloudflare's CPU burst allowance | T110 S5: local `process.cpuUsage()` vs Cloudflare; `cpuMs` bursts past the limit on an idle isolate (2026-10-21) |

### Operating model (2026-10-10)

From 2026-10-10 the management agent makes every remaining decision and records it here; the owner
gives feedback only. The operating plan (issues, releases, pricing, marketing, routines and the
one-time owner checklist) is the management plan:
https://claude.ai/code/artifact/d08f19a6-8ca1-435a-9a2c-bad0745124e6

### Owner decisions (2026-10-09)

| # | Question | Answer |
|---|---|---|
| D1 | Publisher identity | **semics**: GitHub organisation `semics-uk`, npm scope `@semics-tech` (both confirmed by the owner 2026-10-10), slugs `semics-events` / `semics-esign`. The Atmosphere handle is still to be created |
| D2 | Cloudflare staging | **Yes**: a Workers Paid account for the staging site; spikes S1 and S5 run there |
| D3 | Deadline / priority | **None**: build in the order in §6 (e-sign, free events, waivers, then payments) |
| D4 | E-sign legal scope | **US (ESIGN/UETA) + UK/EU (eIDAS SES), reviewed by a lawyer before 1.0.** Defaults: booking data kept 12 months after the event, signed records 7 years, both configurable |
| D5 | Pro pricing and billing | **Decided by the management agent (2026-10-10):** per site per year. Events Pro $79, E-sign Pro $79, Suite Pro $129, agency (10 sites) $349; 40% off the first year for the first 100 customers; Paddle as merchant of record |
| D6 | Pro licence terms | **Decided by the management agent (2026-10-10):** one key per production hostname (local and preview hosts free), a year of updates and support, perpetual use of versions released in the term, 14-day refund (R89; was 30 days), commercial licence (text: R90) (modify for own use, no redistribution), data never locked |
| D7 | Storage collection names (T020) | Keys must match `^[a-z][a-z0-9_]*$`, so E-sign's audit collection is `audit_events` (was `auditEvents`). Any future multi-word collection uses snake_case. The sandbox test host does not enforce unique indexes; tests assert the declaration instead. |
| R28 | Audit personal data after retention (T023) | The retention purge clears `personal` and **deletes `piiSalt`**, so low-variety values (IPs, emails) can't be guessed from their commitments; the chain and hashes still verify. A value disclosed later can no longer be proven against its commitment, an accepted trade-off for data minimisation. `from-intent` runs at 9 bridge calls (hard limit 10, target 8) |
| R29 | No Turnstile on the signing ceremony (T024) | The 256-bit signing token is the credential. Wrong tokens on session, submit and decline count against one per-IP counter (20 per 10 minutes); `public/session`, which every ceremony opens with, reads it before the lookup and refuses an IP over the limit (1 call; session first view 7 → 8). Submit (9 calls) and decline only count, so guessing through them is not slowed, which 256-bit tokens make moot (T117). Turnstile would add a settings read and a fetch to routes already at 7–8 bridge calls. Revisit only if abuse appears |
| R30 | Checkout reserve fits 10 calls (T047) | `config/save` writes a counter-free `catalog` on the event config so checkout reads one document (stale capacity can't oversell: guards pin the planned capacity); the per-IP limit counts recent bookings by salted `ipHash` (new bookings index `[ipHash, createdAt]`, 10 per 10 min) instead of a KV counter; compensation is bounded by the budget and the sweeper finishes it. Bodies are validated with `zod/mini` (bundle 23 → 56 KB; replaced by a built-in validator with the same issues in T118, R42). No Turnstile secret configured means no bot check (the admin page warns) |
| R31 | Signing submit only from `in_progress` (T025 review) | The view transition (`sent → in_progress`, writes `signer.viewed`) happens in `public/session`, only when called with `open: true`: the sign page sends it with its first POST (sign or decline), never on a GET, which a mail scanner may have made (T117); `submit` refuses a `sent` envelope with `SESSION_REQUIRED`. This removes the audit-head race whose rebuild path reached 13 bridge calls (hard limit 10). Fixed in T112 |
| R32 | Clear-text signing tokens in the outbox (T027) | Unavoidable at queue time (only hashes are stored elsewhere); the drain scrubs body and payload in the same write that marks a row sent or failed (T113), and retention purges old rows. Email bodies use a plain `fill`, not `renderTemplate`, whose Markdown escaping corrupts base64url tokens and hyphenated names |
| R33 | Attendee check-in codes go to the booking's token holder (T055 review) | The buyer owns the tickets and needs passes on the booking page; `public/booking` returns codes only after `verifyToken` and never in the outbox or URLs. Sandboxed refusals are `{ ok: false }` inside `{ success: true }`: `callPublicRoute` treats them as errors (T055 fix) |
| R35 | Native UI never imports `@semics-tech/shared` (T054 review) | The UI halves ship as source/tsc output, not through the sandbox bundler, so a private source-only import would break published installs. Enforced by `scripts/ui-imports.test.mjs`; small helpers are written locally with Web APIs |
| R36 | Signed-copy link has its own token (T033 review) | Rotating the signing token at completion broke the sign page's post-submit poll; the completion email mints a separate copy token (hash stored as `copyTokenHash`) that only opens the closed state and download link. Fixed in T115 |
| R37 | Cores self-schedule their crons (T056 finding) | EmDash 1.2 skips `plugin:activate` for config-declared sandboxed plugins, so recurring tasks are never scheduled on an npm install. Both cores ensure their schedules without relying on activation (T116), and the upstream behaviour is reported |
| R34 | Emailed booking links use a one-time code, not the access token (T050) | The confirmation is rendered at send time (the outbox row holds ids only) and carries `/booking?ref=<ref>&k=<code>`; only the code's SHA-256 is stored (`redeemHash`, 7 days). The booking page POSTs `{ bookingRef, code }` to `public/booking/redeem`, which swaps in a fresh access token for the HttpOnly cookie and clears the code (single use, constant-time check, unknown ref = wrong code = expired = `NOT_FOUND`). Redeeming replaces `accessTokenHash`, so an older token stops working. The redeem must be a POST from a button or the server after a click, never a GET side effect, so mail scanners that prefetch the link cannot burn it. A crash-retry of the send mints a newer code and invalidates the earlier link. The drain sends one email a minute (8-9 bridge calls per tick), the cost of rendering from fresh reads |
| R38 | Sandboxed JSON routes answer refusals with HTTP 200 (T034 review) | EmDash 1.2 gives a sandboxed route no way to set the status of a JSON response: a returned value is always wrapped as `{ success: true, data }` with 200, and a thrown error becomes 400 `ROUTE_ERROR` (only the host's own 503 codes keep a status). Only `response: "raw"` routes set a status, and they drop the envelope that `callPublicRoute` and every other caller rely on. So refusals stay `{ ok: false, error: { code } }` inside a 200 (as R33), `toRouteError().status` is used by raw routes (`public/download`), and the HTTP column of the protocol's §9 is what a non-sandboxed implementation should send. Revisit if EmDash adds a status to the JSON route contract |
| R39 | UI calls carry the visitor's request metadata (T034 review) | `callPublicRoute` builds a new `Request` for the in-process handler, which had no user agent, client-IP header or `cf` object, so every ceremony audit event lost IP and user agent and every per-IP limit (`public/verify`; the Events checkout, fixed in T056) became one site-wide `unknown` bucket. Pages pass `Astro.request`; the helper copies its headers except cookies, credentials, the Referer and body framing, and its `cf`. The host still applies its own trust rules (`cf-connecting-ip` only with `cf`, otherwise the configured trusted proxy headers), exactly as for a direct call |
| R40 | Pro code never enters the public repo (T063 pre-check) | The public repo is wholly MIT and its history will be published, so Pro packages live from day one in a separate local git repo `../emdash-plugins-pro` that links the public workspace packages; T071 creates it, and every Pro task depends on T071. The private GitHub repo is created when the owner sets up GitHub |
| R41 | How a Pro build is made (T071) | Each Pro package's `src/plugin.ts` imports the linked Free core's default export and composes it with `extendCore`: Free routes and hooks are kept as they are, Pro routes are added, a Free route is replaced only through an explicit override, Pro cron jobs run before Free's. The Pro manifest is generated from Free's plus additions (identity can't change, nothing Free declares can be replaced or removed). The licence public key, product and build date are generated constants (key from the environment or a committed public key file; development builds use a throwaway key that a release refuses); no private key exists in either repo. Gating new work costs one bridge call (`settings.get`); in-flight work never checks. The public cores needed no extension point for this; a Pro feature that needs a Free seam adds the smallest MIT one here first |
| R42 | Bundle headroom before more Pro features (T063 finding) | The Pro Events backend is at 127.0 KiB of a 128 KiB per-file limit; T118 finds the limit's source and creates ≥ 24 KiB headroom (prefer shrinking the Free core) before T064/T073 add code. **Done (T118):** the cap is the registry bundle format's (`plugin-cli` `validate`/`bundle` and the runtime's registry install check; `sandboxed: [...]` installs are not checked, §7), kept for every build; Free Events dropped `zod/mini` for a built-in validator and the cores share small helpers, `@semics-tech/shared` is `sideEffects: false`; Events 119.8 → 95.1 KiB, E-sign 100.9 → 99.3 KiB (after T117), Pro Events 127.0 → 102.8 KiB, Pro E-sign 104.9 → 103.6 KiB; every `backend.js` must stay ≤ 104 KiB (build tests in both repos). Pro E-sign is only 0.4 KiB under that budget, so the next E-sign Pro feature needs more Free savings or a recorded change of the Pro budget. Pro signs intents with the protocol HMAC directly (shared `ESIGN_PREFIXES` + `encodeBase64Url`), verified against `verifyIntentToken` in tests |
| R43 | Pro bundles are not held to the registry's 128 KiB cap (T118 finding) | The cap is a registry-format rule (plugin-cli `validateBundleSize`, registry-verification); config-declared `sandboxed: [...]` installs from npm are not size-checked, and Pro ships only via private npm until the registry supports paid plugins. Free bundles stay ≤ 104 KiB so they remain registry-publishable. Pro gets its own ceiling of 256 KiB per backend plus a cold-start CPU assertion (first invocation parses the bundle within the 50 ms budget), and validates structure without the registry size check. Revisit if Pro moves to the registry |
| R44 | Free cores declare every secret setting a Pro build stores (T067 finding) | EmDash 1.2 refuses to list an encrypted setting whose key the running manifest does not declare as a secret, so one Pro-only secret (the licence key, Stripe keys) made every Free `settings.list` throw after a switch back to Free: checkout and the admin stopped. The Free manifests declare them, labelled "(Pro)" and ignored by Free (Events: `licenceKey`, `stripeSecretKey`, `stripeWebhookSecret`; E-sign: `licenceKey`); Pro re-words their label and description through `pro.json` `settingsText`, and the Pro generator refuses a secret Free does not declare. A new Pro secret is a public manifest change first |
| R45 | E-sign retention: two stages, and what `/verify` says after each (T097) | Both periods count from when the envelope closed (completed, declined, voided, expired; a draft from its last edit); an open envelope (`sent`, `in_progress`) is never purged, so an unsigned envelope keeps its data until the Free `expire` task closes it (`expiryDays` after sending, R46) or it is voided. **Personal-data period** (`retentionPersonalDataMonths`, default 12, never longer than the signed-records period): `personal` cleared on every audit event, `piiSalt` deleted (R28), the envelope's `signer` block, `fieldValues` and `returnUrl` cleared, and on the signer the name, email, ip, ua, typed name and strokes, entered values, decline reason, `tokenHash` (replaced by a unique non-hash value) and `copyTokenHash`; a draft is deleted with its events; old sent/failed outbox rows go. The **signed record keeps `artifacts`, `snapshots` and the chain** for the **signed-records period** (`retentionSignedRecordsYears`, default 7): they print what was signed (the certificate's signer name and IP and the participant's name, a minor's when a guardian signed; the signer's entered values under "Details entered by the signer" on the PDF; `{{signer.name}}` in the text; corrected to match the code in T103, legal brief §12), and "retention keeps artifacts" means exactly this period. Meanwhile `/verify` still matches the stored PDF with `chainVerified: true` (the chain verifies without the salt). When the signed-records period ends the PDF and snapshot chunks, the chain and the signer are deleted and the envelope becomes a tombstone (no title, `pdfSha256: null`, `recordsPurgedAt`; status, dates, `docSha256`, `finalHash`, `clientId`/`externalRef` kept so the intent attempt numbering and storage cursors stay intact): `/verify` then answers `{ matched: false }` like any unknown hash, and the page says that old records are deleted. Deletion on request (admin, one signer email or envelope id) runs the personal-data stage at once, whatever the period, but never on an open envelope or a completed one whose PDF is not made yet; the signed record keeps its own period. Consumed nonces are already swept hourly (T061) |
| R46 | Expiry is Free, reminders are Pro (T092) | Without an end an unsigned `sent` envelope was never purged (R45), so closing it is a privacy and retention need, not a convenience: the hourly `expire` task (`expire-more` continues a backlog; 1 query + 3 calls per envelope, 2 per tick) moves `sent`/`in_progress` envelopes past `expiresAt` to `expired` through `transitionEnvelope` and writes `envelope.expired`. Automatic reminders stay Pro (`reminderCadenceDays` is declared Pro-only); Free adds no reminder code. Deletion on request by signer email also finds drafts through an indexed lowercase `signerEmail` on the envelope (a draft has no signer document), cleared by the purge |
| R47 | Free bundle headroom 16 KiB (budget 112 KiB) | Both Free backends reached the 104 KiB budget (Events 103.4, E-sign 103.9) with Free work left (recurring events, waitlist, translations). The registry cap stays 128 KiB; 16 KiB of headroom still absorbs an EmDash upgrade or a hotfix. Trimming without behaviour change stays the first resort |
| R48 | Waiver invitations to other adults are bounded (T119, Phase 3 review F8) | E-sign emails every `delivery: "email"` signer from the site, so a waiver order could make it mail arbitrary addresses. Rules: an email intent goes only to the address the buyer entered for that seat (the buyer's own seat and minors are signed inline); **at most 10 emailed adults per booking** (Pro `MAX_EMAIL_SIGNERS`, refused at continue with `WAIVER_TOO_MANY_EMAILS` before anything is held or sent; 10 is also how many refs the booking page reconciles); once a booking is `awaiting_signature` (or a waiver booking `awaiting_payment`) continue refuses to re-describe a seat (`ATTENDEES_LOCKED`), so a re-issued intent names the same person, reuses the open envelope and sends no second invitation (a new one only after that envelope is declined, voided or expired). The rate limit is the existing per-IP reserve limit (10 bookings per 10 minutes), so one connection can trigger at most 100 invitations per 10 minutes. No per-recipient limit at e-sign: it would need a counter write on `from-intent` (9 calls); revisit if abuse appears |
| R49 | A Stripe payment of the wrong amount is refunded, never confirmed (T120, Phase 4 review F4) | Every paid session's `amount_total` and `currency` are compared with the `stripe:<sessionId>` record (the booking's `totals` after any promo, written by checkout, or by the adopt path from the booking) before anything confirms. A mismatch, including a missing amount or currency, is **refunded in full automatically** (reason `amount_mismatch`, key `refund-<sessionId>-amount_mismatch`) and logged as a warning; the booking is left as it was (still payable through "Pay now"; an expired one stays expired). Refund rather than hold for the owner: the money is not the booking's price, nothing a buyer can do makes it right, and a held payment would need an owner workflow that does not exist. No refund email (it would name the booking's total, not what was charged; Stripe's receipt does). Only reachable by a session someone made on the merchant's account with this booking's id and ref. Related (T120): stale `pending` records are reconciled by the Pro `stripe-reconcile` task (one `GET /v1/checkout/sessions/<id>` per record, 1-2 a tick, ≤ 8 calls, schedules flag v8); refunds use one idempotency key per session and reason, and Stripe's `charge_already_refunded` closes the ledger; a late payment (R2) takes its promo code's use again when the repair had given it back, or is refunded as unavailable |
| R50 | Self-serve signing starts with an emailed link, not an on-screen one (T093) | A public form that creates an envelope for whatever name and address a visitor types would let anyone sign in a stranger's name and email that stranger. Decision: the route answers only `check_email`; the signing link goes to the typed address and nothing else (no token, link or envelope id in any response), so a self-serve signer's identity is control of that inbox, exactly the Free email-link model (`docs/legal/brief.md` section 6), plus the emailed code when the settings ask for one: self-serve envelopes use the same `otpFlag` rule as every contract template (on by default), so the recommended setup also proves the inbox at signing time. No envelope is sent until the one-shot `self-serve-<id>` runs: `start` writes a `draft` only (10 bridge calls: gate 1, address limit 2, settings 1, Turnstile 1, template 1, daily cap 2, draft 1, schedule 1). Turnstile is mandatory (no keys, no form: `describe` answers `TURNSTILE_NOT_CONFIGURED` so the block stays hidden); a filled honeypot looks like success; 5 starts per address per 10 minutes before the Turnstile call; a per-template daily cap (default 50, 1-1000, KV counter); the block's endpoint refuses cross-site posts (`isCrossSiteRequest`). A template is self-serve when its head has `public: true` (the flag Free's schema always carried) set by the licence-gated private route `pro/templates/self-serve`. Accepted residual risk: a determined abuser with many addresses and solved challenges can send one template's daily cap of emails to one victim; the cap and the Turnstile bound it, and a per-address dedupe was rejected because an id derived from an email is a guessable hash that outlives the retention purge (R28) |
| R51 | Free bundle headroom 12 KiB (budget 116 KiB) | Recurring events (T084) costs ~4.5 KiB and the Free Events backend was at 110.9 KiB after trimming; removing the admin event editor would break sites that map a non-default collection (the T043 panel is scoped to `events`). 12 KiB under the 128 KiB registry cap still covers a hotfix. Translations (T102) must keep message tables out of the sandboxed backend where they can (native UI half), and every later Free backend feature must be offset by trimming first |
| R52 | Custom attendee questions are answered once per booking, and live wholly in Pro (T080) | The booking widget collects only the buyer, so the buyer answers each question once; the answers go on the booking (`answers`, keyed by question id, the Free schema's existing field) and every attendee row of the CSV repeats them, one column per question. Questions are `config.questions[]` (also an existing Free field): `text` (≤ 500 chars), `select` (one of ≤ 20 options), `checkbox` (ticked = `yes`), each optionally required, ≤ 20 per event. The Free backend gains nothing (R51): Pro wraps `editor/tickets` (an "Attendee questions" form; saving is new work, licence-checked, an `updateIf` that sets only `questions`, 7 calls), `public/event` (adds `questions`, 0 calls), `public/checkout/reserve` (takes `answers` off the body and checks them at Free's draft write, so a refusal comes after Free's validation, rate limit and Turnstile and before any seat is held: `BAD_REQUEST` with `answers.<id>` issues; 0 calls) and replaces `attendees/export` (3 calls; the reports export keeps the questions it started with). Answering never checks the licence. The Free UI renders questions only when `public/event` lists them and sends `answers` only then (Free's reserve refuses unknown keys). Waitlist offer bookings carry no answers. Per-attendee answers wait until the widget collects attendees |
| R53 | Uploaded PDF templates are stamped in the sandbox by a minimal incremental-update writer, not `pdf-lib` (T094) | `pdf-lib` (~523 KB) cannot fit the Pro E-sign backend (152.9 of 256 KiB, R43), so R25's allowance of one `pdf-lib` stamp per invocation is superseded. Pro reads only what an update needs: cross-reference tables and streams (object streams, PNG predictors, `/Prev` chains, hybrid files), the trailer and the page tree with inherited Resources, MediaBox, CropBox and Rotate; FlateDecode only, through the platform's `DecompressionStream`. It appends one incremental update: each stamped page rewritten with its content wrapped `q … Q` and a stamp stream drawn in displayed coordinates (a `cm` undoes `/Rotate` and the box origin), Helvetica added to a copy of the page's resources under unused names, the certificate pages (Free's certificate with PDF wording, rendered by the shared writer and grafted under the page-tree root) and a cross-reference section of the file's own kind; the same inputs give the same bytes. The original is the signed file's unchanged prefix: `docSha256` is the SHA-256 of the upload (shown to the signer, bound into the signature and `finalHash` as for text) and the certificate states the original's length; `pdfSha256` covers the whole file, so `public/download`, `/verify` and retention are unchanged. Uploads come from the media library (`media:read`, `media:bytes:read`), at most 3 MiB, and are refused with `NOT_A_PDF`, `PDF_TOO_LARGE`, `PDF_MALFORMED`, `PDF_ENCRYPTED`, `PDF_ACTIVE_CONTENT` (JavaScript, Launch, XFA, RichMedia, SubmitForm or ImportData names outside stream data or inside object streams, `#xx` escapes decoded) or `PDF_UNSUPPORTED` (another filter on a cross-reference or object stream, more than 500 pages); they are stored as hash-addressed `pdf_files/<sha256>:<i>` chunks in the `artifacts` format (R24), never deleted while a template or envelope names them. The signer gets links to open or download the PDF (a 1-hour signed `d` link on `public/download`, only while the envelope can be signed), not an embed: EmDash serves raw plugin responses with `Content-Security-Policy: sandbox; default-src 'none'` and `nosniff`, so no script in the file runs in the site origin, but browsers' PDF viewers do not run in sandboxed frames, and server-side page images would need a PDF renderer far over budget. Measured locally (workerd harness, which over-estimates Cloudflare, R27): Pro E-sign backend 152.9 → 187.9 KiB, cold start 5.7 ms (`process.cpuUsage` around the bundle's first import); upload and render each cost about 7 ms per MiB plus 2 ms on a cold isolate (2 MiB 17-19 ms, 3 MiB 22-25 ms, 4 MiB 29-32 ms), so one invocation is enough and no cron split is needed; 3 MiB keeps 2x headroom for slower CI and Cloudflare variance (raise it only after T111 measures staging). Calls: upload 5, update 3, send 7, session 5 (first view 8), document link 3, render 7 |
| R54 | QR passes are encoded by the Pro core and drawn by the Free UI; the check-in screen is a Free UI page over a Pro private route (T082) | The QR encoder is Pro code, so it lives in the Pro backend (R40), not in the UI half that ships as source to every site: Pro wraps `public/booking` to add `qr: { size, bits }` (byte mode, level M, versions 1-10, lowest-penalty mask, about 3.5 KiB minified; 0 bridge calls; no licence check, an issued pass is in-flight work) and the MIT `<TicketPass>` draws any well-formed matrix as an SVG. The task said "generated in the browser"; the point (no third-party QR service ever sees a code) holds because the site's own core makes it, and the browser downloads no encoder. The staff screen `/_events/check-in` is injected by the Free integration (MIT) and posts to the private Pro route `checkin/code` with the signed-in admin's session (`X-EmDash-Request`), so EmDash's own auth decides who may check in and no new credential exists; the camera uses the browser's `BarcodeDetector` where present (no decoder shipped; elsewhere, e.g. iOS Safari, the code field), and the screen needs JavaScript (the Block Kit Attendees page is the no-JS and Free path). `checkin/code` runs the Free `checkIn` rules (booking `confirmed`, first scan wins, pending waiver refused with the door signing link), is new work behind `licence.gate` (1 call), at most 5 calls. The Free backend gains nothing (R51); Free answers 404 and the screen says it needs Events Pro |
| R55 | E-sign Pro MCP tools sit on their own private routes declaring `plugins:manage` (T096) | EmDash registers a plugin MCP tool only when its route declares a permission equal to the tool's, and no Free route declares one (a private route without one is checked against `plugins:manage`). Decision: the five tools (`listTemplates`, `sendForSignature`, `getEnvelopeStatus`, `remindSigners`, `voidEnvelope`, the only `destructive` one) are Pro routes `pro/mcp/*` that declare `plugins:manage`, the same check the admin pages pass, so an MCP client (after an admin enables the plugin's tools and consents) can do exactly what an admin can and no lower role gains access; Free is unchanged. They wrap the existing handlers: Free `templates/list`, `envelopes/get` (minus the document text), `envelopes/void`, Pro `pro/envelopes/send` for 2-10 signers, and for one signer Free `envelopes/create` plus a one-shot `mcp-send-<id>` that runs Free `envelopes/send` (create and send in one invocation would be 12 calls; the job is 9, like the route). `remindSigners` is the reminders task's own reminder for one due signer per call (live link, not emailed in the last hour, under `MAX_REMINDERS`), 8 calls. Sending and reminding are new work (licence-gated, like the routes and the reminders task); listing, status and void are not. Schemas are JSON Schema on an object-literal default export, so the build ships them in the manifest and strips them from the runtime (Pro backend 190.1 KiB) |
| R56 | The accessibility gate is axe-core with every WCAG 2.0/2.1/2.2 A and AA rule in the playground e2e, not a Lighthouse run (T101) | Lighthouse's accessibility score is computed from axe-core audits, so a page with no axe violation of those rules scores 100; Lighthouse itself would add a large dependency and a second Chrome launch per page to an 8 GB, nearly full build machine. Decision: `e2e/t101-accessibility.spec.ts` requires zero WCAG A/AA violations (any impact) on every public page the Free plugins render, at 1280 px and 320 px, plus checks axe cannot make (Tab reaches every control with a visible focus ring, no sideways scroll at 320 px, the email-code step by keyboard with no code in a URL, refusals tied to their fields). Third-party pieces are out of scope and noted: the Turnstile frame (Cloudflare) and EmDash's `LiveSearch` focus style in the playground theme |
| R57 | Events Pro reminders and broadcasts ride the Free outbox; opt-out is a Free UI page over a Pro route (T083) | EV-FR-08 asked for reminders at configurable offsets, update and cancellation broadcasts, and an opt-out link; the Free backend had 131 B of headroom (R51), so it gains nothing. Reminders: the Pro recurring task `reminders` (`*/15`, scheduled by `ensure-schedules-pro`, flag v11) queues one `event_reminder` outbox row per confirmed booking when its event (`info.startsAt`) or date (`catalog.occurrences`) is `reminderHours` away (Pro setting, default 24, up to three offsets, empty = off). Each tick covers the time since the last (KV `cron:reminders`, cursors for more than 50 configs or bookings), and the row id `remind-<h>h-<bookingId>` is read back before writing, so a booking is reminded exactly once per offset; queuing is new work (licence read), 8 calls. Broadcasts: the Pro `/broadcasts` page ("Email attendees", new work) stores a `broadcasts` doc and queues its one-shot `broadcast-<id>`, which pages the event's (or date's) confirmed bookings ten per tick and queues one `event_broadcast` row per recipient: the buyer and each seat's own address, deduplicated, at most 10 per booking (R48), 7 calls. A broadcast row carries the admin's subject and message (no token or code) so the drain reads nothing more. Both kinds render in the Free drain through `DrainDeps.render` (the drain's own budget; no extra call). Opt-out: plugin routes cannot answer HTML, and a GET side effect would let mail scanners unsubscribe people (R34), so the link opens the Free UI's `/_events/opt-out?ref=&w=&s=` page (MIT, like R54's check-in screen), whose button POSTs to the Pro public route `public/mail/opt-out`; Free answers NOT_FOUND ("link not valid"). The signature is HMAC-SHA256 over ref and recipient keyed by the booking's `accessTokenHash` (no key read during the drain; a redeemed booking link replaces the hash, so older opt-out links stop working and the next email carries a fresh one). An opted-out recipient (`mailOptOut` on the booking) gets no reminders or updates; cancellation notices always go out, without the link. A cancellation broadcast is only an email: sales and refunds stay the admin's separate steps. Throughput is the Free drain's two messages a minute |
| R58 | Translations live in the UI kits only; the cores answer with codes (T102) | Message tables in the sandboxed backend would cost bytes the Free Events backend does not have (R51: 131 B of headroom) and every language would grow it. Decision: each package's `src/i18n/` (en, ar; exported as `./i18n`, a copy per package because neither may import the other or shared, R35) holds every text of its components, injected pages and client scripts; the cores keep answering with codes and statuses, which the UI turns into text. Client scripts carry no text: the page renders theirs into a `data-messages` attribute. The language is the component's `locale` prop, else `Astro.currentLocale` (sites that want one language everywhere configure Astro i18n), else `en-GB`; there is no integration option, so the suite's wiring is unchanged. Components set `lang`/`dir` on their root and pages on `<html>`; styles use logical sides only. Enforced by `scripts/i18n-strings.test.mjs` (no text in UI sources, no physical sides, pages set lang/dir) and the playground's `e2e/t102-i18n.spec.ts` (ARIA snapshots in en and ar, mirrored layout, 320 px, axe in Arabic). Accepted: emails, calendar files and the Block Kit admin, rendered by the cores, stay English in 1.0; the suite's own pages (`<BookingWithWaiver>`, `/_events/waiver`, `/_events/templates`) are not yet translated (follow-up) |
| R59 | Events Pro MCP tools sit on private `pro/mcp/*` routes declaring `plugins:manage`, as E-sign's do (T086) | Decision mirrors R55: seven tools on Pro routes, JSON Schema on the object-literal default export (the build ships them in the manifest and strips them from the runtime), Free unchanged (the Free backend gains nothing, R51). `listEvents` and `getAvailability` are Free's `public/events` and `public/event` (only public data: seats left, no counters; ≤ 2 and ≤ 5 calls with the schedule check's KV read). `findBooking` by `ref` is Free's booking status and `cancelBooking` (destructive) Free's cancel with Pro's refund step, both run on the admin's authority: the booking read by its ref carries the hash of a token minted for that call, so Free's token check passes and nothing else changes; the token is never stored or returned. The admin's policy differs from the buyer's in one way: cancelling is open until the event starts (cutoff 0, not `cancelCutoffHours`); a paid booking is refunded in full first. The answer leaves out the passes' check-in codes (R33) and mints no calendar link. `findBooking` by `email` lists up to 20 of that buyer's bookings (1 call). `listAttendees` pages an event's attendees 50 at a time with their booking's ref and status, without codes (2 calls). `checkInAttendee` is Pro's `checkin/code` (now also by attendee id), new work behind the licence as on the check-in screen (≤ 5 calls). `refundBooking` (destructive) is the bookings page's full refund (`refundByRef`, shared with the form; 9 calls for one ticket type). Cancel and refund are in-flight work and never check the licence (refunds, R2), like E-sign's void. Budgets as on the routes they reuse: everything ≤ 8 except a paid cancel and a refund (≤ 10, as on `public/booking/cancel` and the bookings page). Pro backend 206.5 KiB (+2.9) |
| R60 | Events Pro MCP paid cancel and refund keep the 10-call ceiling, not the 8 target (T100) | Measured in `mcp.editions.test.ts`: `cancelBooking` on a paid booking is 10 calls (Free's cancel with Pro's refund step, which adds the payment read, the Stripe refund and the payment write), `refundBooking` 9 (`refundByRef`, the bookings page's path). Both are the routes they reuse (`public/booking/cancel` on a paid booking, the bookings page's refund), already asserted at ≤ 10 and budgeted so the counters give way first (drift repair settles them); neither path logs, so no log call can be the 11th. Reaching 8 would mean a second cancel implementation for MCP alone. Accepted; revisit if Free's cancel loses a call |
| R61 | Rate-limit counters are swept, and the Events IP-hash salt is a random site secret (T100, T057 F6, T081) | EmDash KV has no TTL, so every `rl:<scope>:<ip hash>:<window>` key stayed for good, and E-sign's and the promo check's salts are public constants: the keys were a reversible log of visitors' IPs. The shared `rateLimit` now stores `<count>:<window end, epoch s>` and `sweepRateLimits` deletes ended (or unreadable) `rl:` keys; both cores' retention passes start with it (3 deletes a tick, ≤ 8 calls). The `rl:` prefix with that value format is the convention for any counter that must not outlive its window: E-sign Pro's self-serve daily caps moved to `rl:ss-cap:<template>:<day>` with the day's end. Events: without a Turnstile secret the booking `ipHash` and the waitlist limiter were salted with the plugin id; the first public write now stores a random `ipSalt` in the plugin's settings (undeclared, so never shown in the admin; in the Turnstile call's place, so reserve stays ≤ 10) and every later one reads it from the `settings.list` it already makes. Free Events backend 115.97 KiB of 116 after trimming the scaffold `hello` route and internal error strings |
| R62 | Accepted after review: no limit on `from-intent`, none on wrong booking tokens and codes, a resubmit re-issues a held booking's token, thrown route errors are fixed strings (T100) | `from-intent`: a malformed token costs 0 bridge calls and an unknown `cid` 2 reads and no write; nothing gets past the HMAC without the client secret, and a per-IP counter would cost 2 calls on a route at 9 (tested). Booking, cancel, redeem, continue and the waitlist claim: tokens and codes are 256-bit (`generateToken`); an unknown ref now pays the same decoy hash as a wrong token everywhere (`verifyToken` takes a missing hash). Resubmitting an order with its idempotency key and the same buyer email and lines returns a held booking with a fresh token (a confirmed one keeps its emailed token): the key is 256-bit, made in the browser when JS runs; without JS it is in the server-rendered form, so a page cache shared between visitors would share it, which still needs the victim's email and exact order within the hold. Thrown sandbox errors reach callers as `400 ROUTE_ERROR` with the raw message: every message the cores build is a fixed string or interpolates an allowlisted constant, kind or zone (`scripts/security.test.mjs`); `src/astro/lib/markdown.ts`, which the E-sign core imports for the signed PDF (T117), must import nothing (same test) |
| R63 | Personal data in Pro stores is bounded too (T100) | Events Pro's stored full exports (`report_exports`, names, emails and answers per attendee) were never deleted, so they outlived the retention period and deletion on request: an export now carries an indexed `expiresAt` 24 hours after its last step, stops downloading then, is deleted by the rollup's first idle tick of each gap (≤ 4 calls), and a new export deletes the earlier one's parts. E-sign Pro's PDF reader (R53) caps what a file's cross-reference and object streams inflate to at 16 MiB in all (`PDF_UNSUPPORTED`; a 3 MiB deflate bomb could reach gigabytes) and predictor rows at 1024 bytes, checked by a seeded fuzz of the T094 fixtures. The OTP's five attempts per code are claimed with one atomic `updateIf` (`otpTries`, `lt 5`, `inc 1`) before any answer, so concurrent guesses share them (verify 8 calls, a wrong code 5) |
| R64 | The 1.0 trust contract is frozen in a committed snapshot per build (T106) | Each Free core's `trust-contract.json` (and each Pro package's, in the Pro repo) records slug, capabilities, allowed hosts, public routes with methods, MCP tools and hooks; `tests/trust-contract.test.ts` (Pro: the build suite) compares it with the built plugin, beside readable assertions. Adding any of these after 1.0 is a major version with a new snapshot (§9). The publisher is left out: the placeholder DID (R21) is replaced once, before the first publish, and `release-dry-run --release` refuses it. Both manifests now declare `release.requires: { "env:emdash": ">=1.2.0 <2" }` (§9 asked for it; it was missing), equal to the npm peer range (EV-NFR-07); Pro keeps it when it drops Free's listing (R74) |
| R65 | 1.0 release candidates are cut with Changesets pre mode `rc` (T106) | `changeset pre enter rc` + `changeset version` made `1.0.0-rc.0` of the three products, with changelogs; Changesets keeps the consumed changesets in `.changeset/pre/`, which the changeset check now reads. The products are no longer `"private"`: publishing still needs the real DID (R21), the npm and registry credentials and the owner's run of the release workflow, which publishes under the `rc` dist-tag. Pro packages are versioned `1.0.0-rc.0` in lockstep (their `private` flag stays; the Pro workflow lifts it at publish). 1.0.0 is cut with `changeset pre exit` + `changeset version` after the RC soak (owner action) |
| R66 | Traceability: every FR and NFR of the five PRDs maps to a test title (T106) | `docs/requirements/prd.json` lists the 108 FR/NFR ids (user stories are covered through them and are not listed); `scripts/traceability.mjs` counts an id only in the title of a test that runs (`it`/`test`/`describe`, not `.skip`/`.todo`/`.fixme`), so `pnpm verify` running it means it passes. A Free requirement must be traced in this repo, a Pro one here or in the Pro repo (`--pro`). Result at T106: 107 traced, SU-FR-13 not applicable (S5 passed, R25/R53). Mislabelled titles were corrected (EU-NFR-01/02 swapped; four escaping tests wrongly named EU-NFR-05). EU-NFR-05 had no test and no docs: the theming properties are now documented with one default each and checked (`scripts/theming.test.mjs`). SX-FR-06's one-click Connect (conditional in the PRD) is post-1.0; the pairing guide is tested |
| R67 | Licence Worker support tooling; Pro package access is manual for 1.0 (T106, T072 follow-ups; package access superseded by R85) | Support routes `GET /admin/licences` (by email, id or `semreg_` token; never the key) and `POST /admin/licences/sites` (issue the key for a `needs_sites` sale with its registry token, or re-issue for new hostnames with the same term; refunded and cancelled refused) behind a bearer `ADMIN_TOKEN` secret (≥ 32 chars, else the routes 404; digests compared in constant time). A `*/15` cron emails support once about each Paddle event left `processing` > 15 minutes (`alerted_at`, migration 0002). `semreg_` tokens: no registry proxy for 1.0 (new hosting, auth and npm-token custody for little gain at launch volume). Package access: R85 (Pro is public on npm, the key unlocks it; no npm tokens for buyers). The Worker keeps minting, extending and revoking `semreg_` tokens so a proxy or the EmDash registry can honour them later without reissuing. A proxy is post-1.0 |
| R68 | No admin "Waitlist" page in 1.0 (T106, T081 follow-up) | An offer is a held booking in the person's name, so the Bookings page (status filter `held`) already shows who holds an offer, and deletion by email removes waitlist entries. A list of waiting entries is post-1.0; the Free Events backend has 28 B of headroom (R51), so it would need trimming first. The Events guide says so; BUILD-PLAN §3.1's page list is amended |
| R69 | Custom answers stay export-only in 1.0; waitlist offers carry none (T106, T080 follow-up) | R52 as built: answers appear in the attendee CSV and the Pro reports export, not on the booking page or in emails (both are rendered by Free code, and showing them would add a Pro wrapper on `public/booking` and the drain's renderers for little organiser value); an offer is made by the cron without the form, so it has no answers, and the organiser follows up from the CSV. Documented in the Events guide. Post-1.0: show answers on the booking page; ask for them when an offer is claimed |
| R70 | Uploaded-PDF follow-ups are post-1.0 (T106, T094) | A several-signer PDF send route, offering PDF templates to integrations, self-serve and bulk send, and garbage-collecting `pdf_files` chunks are all deferred. One-signer admin sends cover the uploaded-contract case; every uploaded version is kept because signed envelopes point to it (each ≤ 3 MiB, admin-uploaded, not signer data), so there is no unreferenced chunk to delete until template deletion exists. The E-sign guide says what 1.0 does |
| R71 | Two emails a minute is accepted for Events Pro broadcasts in 1.0 (T106, T083) | The Free drain's rate comes from rendering each message from fresh data within 10 bridge calls (R22); a 500-recipient broadcast takes about 4 hours and confirmations queue behind it, which the guide now says. A faster Pro drain (batched rows that carry their rendered body, R57's broadcast rows already do) is post-1.0, measured on staging (T111) first |
| R72 | The suite's pages stay English in 1.0 (T106, T102) | `<BookingWithWaiver>`, `/_events/waiver` and `/_events/templates` are not translated; the translations guide already says so. Translating them is post-1.0, following R58 (tables in the UI, a copy per package) |
| R73 | E-sign Pro's PDF active-content refusal stays as R53 for 1.0 (T106, security review finding 20) | `/GoToR`, `/GoToE` and embedded files are not refused: uploads come only from an admin, the original bytes are what is signed, raw responses carry `CSP: sandbox` so nothing runs in the site origin, and refusing embedded files would refuse PDF/A-3 invoices. Revisit if uploads ever come from visitors |
| R74 | Pro manifests drop Free's listing before any registry validate or publish (T106, T103 follow-up) | `pro.json` `drop: ["repo", "sections", "release"]`; the generator keeps Free's `release.requires` when `release` is dropped, so the EmDash range (R64) stays in the Pro manifest while Free's MIT listing files do not |
| R75 | vitest 4.1.12 in both repos (T106, T100 audit) | Clears the dev-only `@vitest/mocker` advisory; the lockfile changes only the vitest packages |
| R80 | The Cloudflare staging playground is the same site as the e2e playground, switched by environment (T111) | `PLAYGROUND_TARGET=cloudflare` swaps the Node adapter, SQLite, local storage and the workerd runner for the Cloudflare adapter (`imageService: "passthrough"`), D1, R2 and the Worker Loader `sandbox()` (the build fails without the `LOADER` binding rather than silently dropping the cores). `wrangler.jsonc`'s top level is local only (no workers.dev, no route); `env.staging` is the one deployed environment, every resource `semics-staging-*`, ids provisioned by wrangler, and the nightly refuses any build output that is not (`staging/target.mjs --assert-build`). `EMDASH_PRO_DIR` links a built Events Pro into `node_modules` (never committed, R40). The deployed site has no `/e2e/mail` or `/e2e/cron` (404), and its D1 is reseeded from a SQL dump of the local e2e seed in which the public e2e admin token is replaced by the hash of the `STAGING_ADMIN_TOKEN` secret |
| R81 | A Cloudflare site must be given its URL (`EMDASH_SITE_URL`) (T111) | Without it `ctx.site.url` is empty, the Pro licence check has no hostname and every Pro work answers `LICENCE_INVALID`, even on licence-exempt `*.workers.dev`; measured under `wrangler dev`. The nightly deploys with `--var EMDASH_SITE_URL:$STAGING_URL`; docs for Pro buyers on Cloudflare should say the same |
| R82 | On Cloudflare every request from one machine is one visitor (T111) | EmDash's `extractRequestMeta` takes `cf-connecting-ip` whenever the request has a `cf` object and ignores `X-Forwarded-For`, so a runner cannot pose as many buyers. The staging checkout race therefore counts `RATE_LIMITED` as a clean refusal next to `SOLD_OUT` (`load/checkout.mjs --shared-ip`: still exactly 5 booked, nothing else), D1 is reseeded after it, and the per-IP proof is `staging/visitor-ip.mjs` (the stored `ipHash` is the runner's address, not "unknown"). Email journeys (R57 opt-out) run on the local Pro build only: the e2e mailbox is per-isolate memory |
| R83 | Lighthouse runs in the nightly against staging, not locally (T111) | Complements R56: `npx lighthouse@12.6.1` on the booking page and the booking block, gated at 95 by `staging/lighthouse.mjs`; nothing is installed on the build machine |
| R84 | npm publishing in both repos is npm trusted publishing (GitHub Actions OIDC); no `NPM_TOKEN` or `PRO_NPM_TOKEN` exists | npm is restricting tokens that bypass 2FA (direct token publishing restricted from Jan 2027). `release.yml` and Pro `pro-release.yml` keep `id-token: write`, their environments (`npm-publish`, `pro-publish`) and `github.repository == 'semics-uk/...'` guards, set no `NODE_AUTH_TOKEN`, and fail first unless npm >= 11.5.1 (pnpm 10.23's publish runs the npm CLI, checked in its source). npm adds a trusted publisher only to an existing package and keeps an unused one 2 days, so a brand-new name is bootstrapped once from the owner's laptop: `scripts/npm-trust.mjs bootstrap --publish` (both repos; npm >= 11.15.0, `npm login` with 2FA) publishes an empty, deprecated `0.0.0-bootstrap.0` under dist-tag `bootstrap` and runs `npm trust github <pkg> --file <workflow> --repository semics-uk/<repo> --environment <env> --allow-publish`; the first real version then comes from CI. Chosen over npm staged publishing (a CI stage needs the trust that does not exist yet, and staging a new name from a laptop still leaves a `0.0.0-stage` placeholder) and over a laptop publish of the real RC (no provenance, a long-lived write path). Free keeps provenance (`NPM_CONFIG_PROVENANCE`, public repo); Pro sets it off (npm makes none for a private repo). Pro moves from the GitHub Packages default to npmjs.com; R85 makes it `--access public` (no paid npm org plan, no buyer tokens) |
| R85 | Pro ships as public npm packages under the proprietary licence; the licence key is what unlocks it (T121) | Owner decision 2026-10-24: no paid npm plan for v1. Folding Pro into the Free sandboxed plugins is not possible (the registry caps a plugin backend at 128 KiB; Events Free + Pro is about 325 KiB), so `@semics-tech/emdash-events-pro` and `@semics-tech/emdash-esign-pro` publish to npmjs.com `--access public` (Pro `pro-release.yml` and the `npm-trust.mjs` bootstrap, still trusted publishing with no npm token, R84). Each has `license: SEE LICENSE IN LICENSE`, ships the Pro LICENSE and no source maps or tests; the Pro source repo stays private and gets no provenance. Anyone can install them; nothing Pro takes new work without a valid key for the site's hostname (`licence.gate`, unchanged: no key, another site's key and a build after `updatesUntil` are all refused). The key email gives the `npm install` line; buyers get no npm token (R67's manual token step is gone). Accepted cost: the built Pro JavaScript is readable by anyone, which §13's honest limit already allowed (the product is updates, support and fixes). Chosen over a paid org plan with per-buyer read-only tokens (monthly cost and a manual step per sale) and over a registry proxy (R67: post-1.0) |
| R86 | The publisher is `did:plc:mire6xkehfirmoj5pmpqgpvq`, handle `semics.co.uk` (T122) | Owner decision 2026-10-24: the atproto account (PDS `https://auriporia.us-west.host.bsky.network/`) exists and its handle is the domain `semics.co.uk`. Every `emdash-plugin.jsonc` and fixture names that DID, `https://semics.co.uk` and `security@semics.co.uk`; the old `.dev` handle and the R21 placeholder are gone from both repos (a test in each greps for them). `release-dry-run.mjs` now requires exactly that DID (`PUBLISHER_DID`): `--require-real-did` (the registry workflow) and `--release` fail on any other publisher. `emdash-release.yml` stays hand-written until the owner runs `emdash-plugin login semics.co.uk` and diffs `release setup --force` against it |
| R87 | Licence email goes through Cloudflare Email Service, not Resend (T122) | Owner decision 2026-10-24. The Pro licence Worker sends with a Workers `send_email` binding `EMAIL` (`"send_email": [{ "name": "EMAIL" }]`, no `allowed_destination_addresses`, so it can mail any buyer; Workers Paid) and the structured `env.EMAIL.send({ from, to, replyTo, subject, text })` call, which throws (`E_*` codes) on failure, so Paddle still retries. No mail API key: `MAIL_API_KEY` is gone from code, config and docs. `MAIL_FROM` is `semics <licences@semics.co.uk>`, `SUPPORT_EMAIL` `support@semics.co.uk`; the owner onboards `semics.co.uk` in the Cloudflare dashboard, Email, Email Sending. The `Mailer` interface stays; tests use a fake binding. Chosen over keeping Resend (a second vendor and secret for a Worker already on Cloudflare) |
| R88 | The product site is `apps/site`, static HTML served as Workers static assets on the custom domain `plugins.semics.co.uk` (T124) | Paddle approves a checkout domain only after reviewing a public site with the products, prices, terms of sale, a refund policy, a privacy policy and contact details. `apps/site/build.mjs` renders `pages.mjs` (home, `/pricing`, `/terms`, `/refunds`, `/privacy`, `/contact`, a 404) into `dist/` with the docs site's colour tokens; `wrangler.jsonc` is assets only (`workers_dev: false`, custom-domain route, `404-page`), deployed with `pnpm --filter site deploy` by the owner's wrangler login. Company facts come from semics.co.uk (SEMICS LTD, 12871299, registered office); prices are D5 (USD per site per year; Paddle adds tax and local currency). Paddle.com is the Merchant of Record and the terms use its reseller wording; refunds are 14 days, no questions asked. No Buy buttons until Paddle approves the domain and a client-side token exists: each plan points to support@semics.co.uk. The docs link goes to the Markdown pages on GitHub until the docs site is hosted. The legal text is plain English by the build agents and awaits the lawyer (`docs/legal/brief.md` §13, question 17) |
| R89 | Refunds are 14 days, no questions asked, on every purchase and renewal; D6's 30 days is superseded (T126) | The live site (R88) already promised 14 days while D6 said 30, and the legal research (`docs/legal/research.md` Q17) flagged the clash. 14 days matches Paddle's own buyer withdrawal window, already exceeds what UK and EU law require for digital content once used, and covers the 14-day renewal cooling-off the UK subscription rules add from 1 January 2027. Raising it later is easy; cutting a published promise is not. The site, D6, the Pro LICENSE and `apps/docs/pages/editions.md` say 14 days; the lawyer is asked to confirm (brief question 17) |
| R90 | The Pro packages ship a real commercial licence from SEMICS LTD, a draft for the lawyer (T126) | The placeholder in `packages/{events,esign}-pro/LICENSE` (Pro repo) granted no right of use and named "Semics", yet the terms of sale grant use under it. The draft follows D6: one key per production hostname (up to 10 for Agency), local and preview hosts (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.workers.dev`, `*.pages.dev`, the shared `isExemptHost` list) free; a one-year Update Term; perpetual use of versions released in the term; modification for own use, no redistribution; data never locked; MIT parts stay MIT; liability by reference to the terms of sale; English law with consumer home-law protection. It is marked as needing the lawyer's review (brief §13 question 17). Both packages carry the identical file (`scripts/licence.test.mjs`); the Pro repo's root LICENSE stays the repository notice |
| R91 | The licence Worker deletes licence records 6 years after the licence ends and Paddle event records after 1 year (T126) | The privacy policy promised deletion after 6 years but nothing deleted anything, and the Paddle event log had no period. The 15-minute cron now runs `purgeExpired` (`licence-worker/src/retention.ts`): a licence ends at the latest of its update term, cancellation and refund; past 6 years the licence and its registry tokens go. Event records are only needed for idempotency over Paddle's retry window (days), so 1 year is ample. The site (`/privacy`) also now names Paddle an independent controller, gives legitimate interests as the basis for website logs and support email, and lists portability and objection; prices note that the total including tax is shown at checkout (DMCCA s.230), and the licence-end sentences say what the code does (an issued key keeps verifying offline; no new keys) |
| R92 | E-sign snapshots are capped at 131,072 characters and 1,500 lines (`DOCUMENT_TOO_LARGE` at send), so the signed-PDF cron renders the largest one inside 50 ms on a CI runner (T125) | CI run 40285880845 failed `hook "cron" used CPU 69.0 ms (limit 50 ms)` on the ~354 KB large-PDF test. Cause (a), not coverage: on a GitHub runner (4 vCPU) the same test without coverage used 41-46 ms alone and 45-57 ms in the full suite, with coverage 45-52 ms (run 40287029213); locally 30 ms either way. Fixes: chunk base64 through a lookup table instead of `String.fromCharCode` + `btoa` (12 of the cron's ~30 ms locally, now ~1 ms), and `layoutLines` finds words with `indexOf` and slices whole lines (same bytes). Nothing bounded the snapshot before (`MAX_DOCUMENT_BYTES` is the 512 KiB storage-document limit, R24; a 100,000-character template can repeat 500-character values), and CPU grows with lines too (260 KB of one-word paragraphs ~170 ms in Node). `renderSnapshot` now refuses a canonical snapshot over `MAX_SNAPSHOT_CHARS` (UTF-16 units) or `MAX_SNAPSHOT_LINES`. The costliest allowed document (1,498 list items filling both limits) measured on CI: 256 KiB/2,000 lines 39-50 ms, 192 KiB/1,500 37-43, 128 KiB/1,500 27-28 incl. the full suite with coverage (run 40295515030); locally 12-13 ms. Budgets stay strict on CI with coverage |
| R93 | The owner issues a Pro licence key without a Paddle sale through `POST /admin/licences/issue` on the licence Worker and `scripts/issue-licence.mjs` in the Pro repo (T128) | The owner needs Pro on their own sites, and for comps and support, before and besides sales; until now a key existed only after a Paddle `transaction.completed`. The route (bearer `ADMIN_TOKEN`) takes `{ plan, sites, email?, updatesUntil? }`: the plan must be one `PADDLE_PRICES` sells, hostnames are validated and counted per plan exactly as at checkout (`sitesFrom`), updates default to a year. It signs with the same issuer (so the key is verified before it leaves), stores an `active` licence with `source = 'manual'` (migration 0003; sales are `paddle`) and no Paddle ids: its own `lic_` id fills the transaction and customer columns and `subscription_id` is NULL, so no Paddle notification can renew, refund or cancel it. No registry token is minted. The key is returned, and emailed only when `email` is given (a failed mail still returns it, `emailed: false`). `/admin/licences` shows `source`. Every admin route now answers a missing or wrong bearer token 404, as for an unset token, instead of 401, so nothing shows the routes exist. The script reads the token from `ADMIN_TOKEN` or the file in `ADMIN_TOKEN_FILE`, refuses a `--token` argument (shell history), never prints it, and prints only the key on stdout |
| R94 | Slot schedules are a Free `config.schedule` whose slots are ordinary occurrences owned by `src/domain/schedule.ts`; the Free Events backend budget becomes 125 KiB (T129) | Sites selling fixed sessions (classes, studios, range lanes) need many slots a day from one schedule, not one RRULE start (EV-FR-17). `config.schedule` = `{ days: MO..SU[], times: "HH:MM"[] (<= 24), durationMinutes (1-1440), capacity, bookAheadDays (1-90, default 56), closedDates: "YYYY-MM-DD"[] (<= 366) }`, local to `info.timezone`; never beside `recurrence` and never with dates of its own (`INVALID_SCHEDULE`). DST: a slot time that does not exist that day is skipped, a repeated one takes the first instant (one `Intl` offset lookup per day, two candidates only on a change day). Slots are occurrences `s-<eventId>-<start base36>`; an event with a schedule or with such slots is schedule-owned and `config/save` leaves its occurrences and catalog entries as stored (it loads only 100 occurrences, so it must never rebuild that catalog; clearing the schedule keeps the slots). The recurring `occurrences` task (no new task, flag unchanged) plans each schedule from the config's catalog alone and, for one event a tick, reads the named slots with one `getMany`, creates up to 50 (`putMany`; an existing document is relisted, never rewritten, so counters and overrides stay), and writes the catalog guarded on a `slotsRev` counter that every schedule-owned catalog writer bumps (panel save, day view), so a write that lost a race is redone next tick: <= 6 calls, 1-5 ms CPU in workerd with 540 slots. At most 600 slots ahead (6 a day for 13 weeks fit; the catalog stays under ~90 KB, R24), and slots leave the catalog 7 days after they start (documents stay). A slot the schedule no longer gives: booked = kept as it is (`kept`, not planned again, even if its bookings are later cancelled); unbooked = taken out of the catalog at once (`unlisted`) and deleted on a tick at least 5 minutes later unless a checkout that planned from the old catalog landed on it (then listed again). New places and lengths apply to slots made afterwards. The panel's Schedule fields edit the schedule; **Show day** lists a day's slots: close, reopen, change places, or the whole day, as overrides on the slot documents (guarded `updateIf`: close needs no seats held or sold, places >= reserved) plus the catalog, up to 5 slot changes a save (2 + 5 + 1 = 8 calls); closing a booked slot is refused with its bookings listed (from the event's first 100 live bookings; bookings have no `occurrenceId` index and the manifest stays unchanged). `public/event` now asks only for upcoming dates (`startsAt >= now`), so hundreds of past slots never hide the next 50. Budget: the feature costs ~8.3 KiB minified (admin day view 4.2, domain 2.3, cron 1.0, wiring 0.8) and the backend had 28 B left (R51); no trim of that size exists without dropping a feature, so the Free Events backend gets its own budget of 125 KiB (`EVENTS_BUNDLE_BUDGET`, 3 KiB under the 128 KiB registry cap; E-sign keeps 116). The Pro packages ship from npm and are not size-checked (R85), so the headroom only has to cover a hotfix. Every later Free Events backend feature (T131 approval first) must trim first; candidates: the E-sign and protocol messages that `ERROR_CODES` carries into Events (~1.5 KiB), and the admin help texts. Follow-ups: drift repair and the `public/event/ics` and admin date lists still read an event's first 100 or 50 occurrences, which for a schedule are the oldest |
| R95 | The booking page lists a waiver booking's attendees as Signed / Waiting with Sign now, Resend and edits until `attendeeEditCutoffHours`; e-sign intents gain optional `resend` and `replace` (T133, Suite Pro) | A site plan asked that a group's waivers be finished after booking: the buyer's phone or a front-desk tablet passed round, a lost invitation sent again, a misspelt name or address corrected. R48 had locked a seat's signer once its intents were out. Decided: Events Pro's `public/booking` adds per seat `seat`, `signing`, `signs` (`inline`/`email`), `email` or `minor`, and `signingList: { editable, editUntil }` for a per-attendee waiver booking that can still be signed (`awaiting_signature`, `awaiting_payment`, `confirmed`), read from what Free's route already read (≤ 8 calls). Three Pro public routes, authenticated by the booking access token in the body (a Pro trust-contract addition before 1.0): **Sign now** (`public/booking/attendees/sign`, 3 calls, in flight) mints one inline intent for the seat by the door-link rules (an adult signs for themselves under their own name and address, the buyer as guardian for a minor), `exp` = the hold or 15 minutes; the Free UI redeems it like `/_events/sign` and opens `/sign/<token>`. The holder of the booking token can therefore start another adult's ceremony on their device: accepted, as at the door, because it is the same person's name and address on a simple electronic signature, the ceremony names them, and the emailed link is rotated (so only one session is live). **Resend** (`.../resend`, 4 calls, in flight) mints an email intent with `resend: true`: e-sign rotates the open envelope's link and queues the invitation again (+2 calls on its replay path, 8), at most 3 per seat, 10 minutes apart. **Edits** (`public/booking/attendees`, 5 calls, new work: licence) until `attendeeEditCutoffHours` (Pro setting, default 24, 0-720) before the booked date (else the event) starts: names and adults' emails of unsigned seats; the seats bought only; a signed seat `ATTENDEE_SIGNED`; each seat at most 3 times; the edited booking re-checked by checkout's waiver plan (own addresses, ≤ 10 emailed adults). Each edited seat gets a `replace` intent, then for an emailed adult the new one: e-sign voids an open envelope that does not name exactly that signer (name included, since the document names them; audited `envelope.voided` by the integration; 7 calls) and creates nothing, so the next intent starts the seat's next envelope as after any void (10, the existing path). Both are idempotent, so saving again finishes a save whose redemption failed. Not done: a two-phase save that voids before storing; the window between storing and voiding is milliseconds in-process, and a receipt for the old envelope in it would be recorded for the seat (the buyer's own doing). Worst case per booking: 10 adults × (1 + 3 edits + 3 resends) invitations. Continue still answers `ATTENDEES_LOCKED`; waiver mode `buyer` gets no list. All UI is MIT (`<AttendeeList>`, `lib/attendees.ts`), no JavaScript needed; the Free backend is unchanged (Events 0 B), E-sign Free gains the two fields (+~1 KiB) |

## 13. Editions and licensing

**Free** is MIT, listed on the registry and npm, and complete for the common case: a free or RSVP
event, and a single-signer agreement. **Pro** adds what organisations pay for: taking money,
running large events with staff, and multi-party or high-volume signing.

**Rules for deciding what is Pro**
1. Free must beat the existing free options. Dateline already ships free RSVPs, capacity, a
   waitlist and confirmation emails; Eventual ships free recurrence and calendar feeds (research §11).
2. Never paywall security, privacy, legal evidence or data export: consent capture, the audit chain,
   retention and deletion, CSV export and the public API stay free. Nobody is locked in.
3. Pro features are ones that earn the organiser money or save staff time at scale.

### Events

| Feature | Free | Pro |
|---|---|---|
| Events from the site's collection, ticket types, capacity, holds | Yes | Yes |
| Free tickets / RSVP, booking page, confirmation email, calendar files, JSON-LD | Yes | Yes |
| Recurring events | Yes | Yes |
| Waitlist with offers | Yes | Yes |
| Self-service cancellation | Yes | Yes |
| Attendee list, CSV export, check-in from the admin by name or code | Yes | Yes |
| Sold/capacity dashboard widget | Yes | Yes |
| Public JSON API and the UI components | Yes | Yes |
| **Paid tickets** (Stripe Checkout, refunds, late-payment handling) | | Yes |
| **Promo codes** and hidden tickets | | Yes |
| **Custom attendee questions** (answers in exports) | | Yes |
| **Required waivers** through `semics-esign` | | Yes |
| **QR ticket passes and the mobile check-in screen** | | Yes |
| **Scheduled reminders and broadcast emails** | | Yes |
| **Sales reports** (30-day chart, revenue by ticket type) | | Yes |
| **MCP tools** | | Yes |

### E-sign

| Feature | Free | Pro |
|---|---|---|
| Markdown templates with placeholders, versioning | Yes | Yes |
| One signer per envelope, typed and drawn signatures | Yes | Yes |
| Consent capture, hash-chained audit trail, signed PDF with certificate | Yes | Yes |
| Hash verification page | Yes | Yes |
| Retention settings and personal-data deletion | Yes | Yes |
| Signer can decline; sender can void | Yes | Yes |
| Signing-intent protocol and integration clients (`esign-intent/1`) | Yes | Yes |
| **Several signers, parallel or sequential** | | Yes |
| **Email OTP identity check** | | Yes |
| Expiry: an unsigned envelope closes `expiryDays` after sending (R46) | Yes | Yes |
| **Automatic reminders** | | Yes |
| **Uploaded PDF templates** | | Yes |
| **Public self-serve templates** embedded on a page | | Yes |
| **Bulk send** | | Yes |
| **MCP tools** | | Yes |

The suite package stays free. The waiver requirement it orchestrates is an Events Pro feature,
while the e-sign side of the protocol stays free, so any other system can integrate with e-sign.

### How Pro is delivered

- **Same plugin, two builds.** A separate "pro" plugin couldn't read the free plugin's storage
  (research §3.3), so Pro is a superset build of the same core with the **same slug and
  publisher**. Moving from Free to Pro, or back, keeps all data (Spike S10 confirms storage
  survives the swap). Downgrading switches Pro features off; it never deletes data.
- **Distribution (R85):** public npm packages `@semics-tech/emdash-events-pro` and `@semics-tech/emdash-esign-pro`
  under the proprietary licence (the Pro source repo stays private), installed with a plain `npm install` and
  `sandboxed: [eventsPro()]` in place of `events()`; the licence key is what unlocks them. Move them to the
  registry when it supports paid plugins.
- **Licence key:** `semics1.<payload>.<signature>`. The payload is
  `{ v, product, edition, sites[], customer, issuedAt, updatesUntil }`, signed with our Ed25519 key.
  It is stored as a `secret` setting. The Pro build embeds the public key and verifies the key with
  WebCrypto: no network call and no extra allowed host (Spike S11).
- **What a key controls:** the site's hostname must be in `sites[]`. A build released after
  `updatesUntil` asks for renewal, while older builds keep working (perpetual fallback). Without a
  valid key, Pro features stop taking new work (no new paid checkouts), but anything in flight keeps
  working: refunds, existing waivers and reports stay available.
- **Honest limit:** Pro code is JavaScript running on the customer's site, so licence checks deter
  copying rather than prevent it. The product is the updates, support and fixes.
- **Repos:** the public repo stays wholly MIT. Pro code lives in a private repo that depends on the
  published Free packages.
