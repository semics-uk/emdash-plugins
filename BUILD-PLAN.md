# Build plan: EmDash Events bookings + e-sign plugins

> Companion to [RESEARCH.md](./RESEARCH.md). Section references (§) point there.
> Target: `emdash >= 1.2.0`, open source (MIT), published to the EmDash plugin registry (sandboxed
> cores) and npm (native UI kits + bundle).

---

## 1. Goals and non-goals

**Goals**
- A full-featured **Events bookings** plugin: ticket types, capacity, holds, free and paid (Stripe)
  checkout, custom questions, waitlist, check-in, emails, ICS, reporting, JSON-LD, MCP tools.
- A standalone **e-sign** plugin that is useful without Events: templates, envelopes, signing
  ceremony, audit trail, certificate of completion, and a generic signing-intent API.
- A **bundle** that wires them together so a booking can require a signed waiver/agreement.
- Registry-installable, sandboxed back ends wherever the platform allows.

**Non-goals (v1)**
- Advanced/qualified e-signatures (AES/QES), certificate-based identity, or PKI signing of PDFs.
- Seat maps / reserved seating.
- A drag-and-drop PDF field designer (needs native React admin; revisit post-1.0).
- Multi-currency carts across events, or marketplaces / multi-vendor payouts.

## 2. Package architecture

Five packages in one pnpm monorepo. Two are the registry plugins. The rest are thin native layers
that exist only because the sandbox cannot render public UI (§2, §9 of the research).

```
                ┌───────────────────────── site (Astro + emdash) ─────────────────────────┐
                │                                                                         │
 npm, native →  │  @semics/emdash-events-ui        @semics/emdash-esign-ui                │
 (UI only,      │   Astro comps + PT blocks         Astro comps + PT block + sig pad      │
  no caps)      │   <BookingWidget> <EventList>     <SigningCeremony> <VerifyDocument>    │
                │          │  SSR in-process                │  SSR in-process             │
                │          ▼  public routes                 ▼  public routes              │
 registry,   →  │  events  (sandboxed)   ◄── HMAC intent/receipt ──►   esign  (sandboxed) │
 sandboxed      │   storage, admin, cron, email,                 templates, envelopes,    │
                │   Stripe, MCP, JSON-LD                         audit chain, cert, MCP   │
                │                                                                         │
 npm, native →  │  @semics/emdash-events-suite (bundle: config helper,                    │
                │   <BookingWithWaiver>, pairing/reconciliation glue)                     │
                └─────────────────────────────────────────────────────────────────────────┘
```

| # | Package | Format | Slug / name | Depends on |
|---|---|---|---|---|
| 1 | `packages/events` | Sandboxed (registry + npm) | slug `semics-events` → `@<handle>/semics-events` | none |
| 2 | `packages/esign` | Sandboxed (registry + npm) | slug `semics-esign` → `@<handle>/semics-esign` | none |
| 3 | `packages/events-ui` | Native npm `@semics/emdash-events-ui` | plugin id `events-ui` | events (runtime, via public routes) |
| 4 | `packages/esign-ui` | Native npm `@semics/emdash-esign-ui` | plugin id `esign-ui` | esign (runtime) |
| 5 | `packages/events-suite` | Native npm `@semics/emdash-events-suite` | bundle | 1–4 |
| — | `packages/shared` | Internal lib (bundled, not published) | — | — |
| — | `apps/playground` | Astro site for dev/E2E (Node + workerd runner) | — | all |

**Why the split:**
- Sandboxed cores keep the trust surface reviewable and installable from the admin.
- UI kits have **zero capabilities**. They only render, and they call public routes in-process
  through `getPublicPluginApiRouteHandler`. A site that wants its own front end can skip them
  and use the documented public JSON API.
- e-sign never imports anything from Events. The link between them is a documented protocol (§6).

> Slugs are prefixed (`semics-events`, `semics-esign`) because they're part of the route URLs,
> can't change after the first publish, and generic names like `events` are likely to collide with
> other publishers' plugins on one site. If Spike S7 shows collisions are impossible, the prefix
> still costs nothing. The prefix should match the final publisher name (see Decision D1).

### Repo layout

```
emdash-plugins/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, .changeset/, vitest.workspace.ts
  .github/workflows/{ci.yml, emdash-release.yml, npm-release.yml}
  packages/
    shared/        # hmac.ts, tokens.ts, money.ts, ics.ts, pdf-mini.ts, rrule-lite.ts, ratelimit.ts, blockkit helpers
    events/        # emdash-plugin.jsonc, src/plugin.ts, src/{routes,hooks,admin,domain,storage}/, tests/
    esign/         # same shape
    events-ui/     # src/index.ts (descriptor), src/astro/*, src/client/*, src/styles/*
    esign-ui/
    events-suite/
  apps/playground/ # astro.config.mjs with sandboxed: [events, esign], plugins: [eventsUi(), esignUi()], seed for `events` collection
  docs/            # protocol spec, operator guides, screenshots
```

## 3. Package specs

### 3.1 `events` (sandboxed core)

**Content model.** Events are ordinary EmDash content in a site-defined collection (default slug
`events`, configurable in settings). The plugin **cannot create collections** (§3.4), so we ship:
- a seed/schema snippet for the collection (`title`, `slug`, `body` PT, `startsAt`, `endsAt`,
  `timezone`, `venue`, `image`, `summary`) in `docs/` and in the playground;
- a settings field mapping (which field holds start/end/timezone/venue) validated via `schema:read`,
  with a Block Kit banner if the mapping is broken.

All booking-specific data lives in plugin storage, keyed by the content entry ID.

**Manifest (v1 trust contract)**
```jsonc
"capabilities": ["content:read", "schema:read", "email:send", "network:request"],
"allowedHosts": ["api.stripe.com", "challenges.cloudflare.com"],
```
Declared up front so adding Stripe/Turnstile doesn't force a major bump and re-consent later.
Deliberately **not** requested: `content:write` (too coarse) and `users:read` (not needed).
`hooks.content-policy:register` only covers `beforePublish/Schedule/Unpublish` policy hooks. We
don't need it unless Spike S9 shows a delete veto requires it (see Hooks).

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
  envelope. A guardian signs for attendees marked under 18. The booking confirms only when every
  attendee holds a valid receipt. With `mode = "buyer"`, the buyer signs once for the whole booking.
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
- Deleting an event with confirmed bookings: if Spike S9 shows `content:beforeDelete` can veto
  without extra capabilities, veto it (with a log reason). Otherwise `afterDelete` marks the config
  `orphaned`, pauses sales, and shows an admin banner listing the affected bookings. Don't block
  `beforeUnpublish`, because that needs `hooks.content-policy:register` and the warning banner is enough.

**Admin (Block Kit)**
- Pages (`group: "Events"` so they sit next to the events collection in the sidebar):
  **Bookings** (table + filters + actions), **Attendees / Check-in** (search by code/name, toggle
  check-in), **Waitlist**, **Promo codes**, **Settings** (collection mapping, hold TTL, currency,
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

### 3.2 `esign` (sandboxed core)

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
| `auditEvents` | envelopeId, seq, type, at, actor, ip, ua, data, prevHash, hash | `["envelopeId","seq"]` |
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
   emails and IPs from `signers`/`auditEvents` without breaking chain verification. Signed records
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
  In both cases the stored hash is computed by the sandboxed core.

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

### 3.3 `events-ui` (native, UI only)

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

### 3.4 `esign-ui` (native, UI only)

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
| S1 | Do `ctx.storage/kv/content` bridge calls count toward **10 subrequests**? | Deploy a probe plugin to CF staging that loops storage gets and records the failure point | Checkout is already split into `reserve` + `continue`. Further fallback: aggressive batching (`getMany/putMany`), denormalised docs |
| S2 | Does `getPublicPluginApiRouteHandler` reach **sandboxed** public routes? | Playground SSR component calling a sandboxed public route | UI kits call routes over `fetch(Astro.url.origin + …)` server-side |
| S3 | One-shot cron format, minimum interval, task limits | Read `core/src/plugins/cron.ts` + probe | Recurring 5-min sweeper only |
| S4 | Max storage document size | Probe writes of increasing size | Chunk snapshots/PDFs across docs, or `media:write` |
| S5 | CPU of `pdf-mini` (5 pages + strokes) and of `pdf-lib` stamping | Benchmark in a Dynamic Worker | Render PDFs in `esign-ui` (native) and hash in core |
| S6 | Can a native UI-only plugin register PT blocks whose data is served by a sandboxed plugin? | Playground | Ship components for manual use in templates and drop PT blocks |
| S7 | Slug collision behaviour across publishers | Docs/registry source | Prefix slugs |
| S8 | Does `ctx.settings.set()` on a non-schema key encrypt? (dynamic client secrets) | Code read + probe | Single `integrationSecret` schema field per client slot (e.g. 5 fixed slots) |
| S9 | Can a sandboxed `content:beforeDelete` hook veto a delete, and does it need a capability? | Runtime test host | `afterDelete` marks the config orphaned and shows an admin banner (already the default plan) |

**Resolved from docs (2026-10-09):**
- `updateIf` guard fields don't need declared indexes, and guards compare against literal values
  only. Hence the single `reserved` counter.
- `hooks.content-policy:register` covers `beforePublish/Schedule/Unpublish` policy hooks only.
  The docs don't mention delete vetoes, hence S9.
- Route names may contain slashes. Dots aren't documented, so route names use slashes only.
- Unique-index behaviour for missing values isn't documented. The design avoids relying on it
  (the `payments` collection is keyed by id).
- Stripe Checkout `expires_at` must be 30 min–24 h after creation.

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
| R5 | Waivers: per-event `signature.mode`, default `each_attendee`, guardian signs for minors | Event waivers normally bind each participant |
| R6 | Signed PDF built once at completion; `pdfSha256` verified against the stored bytes | On-demand PDFs aren't byte-identical, so verification would fail |
| R7 | Audit chain hashes salted commitments of personal data; separate retention for signed records | Lets the retention purge run without breaking the evidence |
| R8 | `payments` collection keyed by `<provider>:<sessionId>`; no unique index on an optional field | Unique-index behaviour for missing values is undocumented |
| R9 | Checkout split into `reserve` + `continue` from the start | The estimated call count is already at the 10-subrequest limit |
| R10 | Distinct HMAC prefix per token type; no tokens in plugin route URLs; `Referrer-Policy: no-referrer` | Prevents token-type confusion and leaks through logs and referrers |
| R11 | Hidden tickets unlocked only by `unlock` promo codes (`unlockCode` removed) | One mechanism, with usage limits and validity windows |
| R12 | Route names use slashes only | Dots aren't documented as valid |
| R13 | Event delete protection: veto only if S9 allows it, otherwise orphan + banner; no `content-policy` capability | Keeps the trust contract minimal |
| R14 | Prefixed slugs `semics-events` / `semics-esign` | Irreversible after the first publish; avoids collisions |

### Owner decisions (2026-10-09)

| # | Question | Answer |
|---|---|---|
| D1 | Publisher identity | **semics**: npm scope `@semics`, slugs `semics-events` / `semics-esign`. Secure the npm scope, the GitHub org and the Atmosphere handle before the first publish |
| D2 | Cloudflare staging | **Yes**: a Workers Paid account for the staging site; spikes S1 and S5 run there |
| D3 | Deadline / priority | **None**: build in the order in §6 (e-sign, free events, waivers, then payments) |
| D4 | E-sign legal scope | **US (ESIGN/UETA) + UK/EU (eIDAS SES), reviewed by a lawyer before 1.0.** Defaults: booking data kept 12 months after the event, signed records 7 years, both configurable |
