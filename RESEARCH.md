# EmDash plugin research: Events bookings + e-sign

> Research date: 2026-10-09
> Source: `emdash-cms/emdash` @ `4cefe58` (core `emdash@1.2.0`), specifically
> `docs/src/content/docs/plugins/**`, `docs/src/content/docs/deployment/plugin-sandbox.mdx`,
> `skills/creating-plugins/**` (the official agent skill), and the first-party plugins in
> `packages/plugins/*` (`forms`, `webhook-notifier`, `atproto`). Where the docs were unclear,
> the source under `packages/core`, `packages/cloudflare` and `packages/plugin-types` was checked.
> Claims marked **[verify]** come from reading the code, not from a doc statement, and should be
> confirmed in a spike before relying on them.

---

## 1. What EmDash is (as it matters for plugins)

- An Astro-based CMS. You add it as the `emdash()` integration in `astro.config.mjs`. Content lives in
  collections with typed fields and Portable Text bodies, with revisions, scheduling, i18n, bylines,
  taxonomies, comments, media and redirects.
- Runs on Cloudflare Workers (D1 + R2) or on Node.js (SQLite/Postgres).
- Plugins are **not** Astro integrations. They are passed to the EmDash integration
  (`plugins: []` / `sandboxed: []`) or installed from the **plugin registry** from the admin UI.
- The registry is decentralized. It runs on AT Protocol: a release is a signed record in the
  publisher's PDS (Atmosphere account), and the identity is `@<publisher-handle>/<slug>`.

## 2. The two plugin formats

| | **Sandboxed** (default, registry-installable) | **Native** (trusted npm package) |
|---|---|---|
| Authoring | `emdash-plugin.jsonc` manifest + `src/plugin.ts` default-exporting a `SandboxedPlugin` | `definePlugin()` / `createPlugin()` + a `PluginDescriptor` factory |
| Install | One-click from the admin registry, or npm + `sandboxed: []` | `npm install` + `plugins: []` + redeploy |
| Runs in | Isolated Dynamic Worker (Cloudflare Worker Loader) or a `workerd` child process (Node) | The site's own process |
| Isolation | Capability-gated bridge; no `fetch()`, no env, no Node built-ins | None. Capabilities are advisory only. |
| Admin UI | **Block Kit** (JSON) pages, widgets, editor panels/actions, field widgets | React (Kumo) components **or** Block Kit |
| Public site output | `page:metadata` only (meta, OG, canonical/alternate, JSON-LD) | + `page:fragments` (scripts/HTML), **Astro components**, **custom Portable Text blocks** |
| Distribution | Signed release in the registry (also usable via npm) | npm only |

Doc guidance: *"Use a sandboxed plugin unless the feature needs host-process access, React admin
code, Astro rendering components, raw page fragments, or custom Portable Text block definitions."*

**Consequence for us:** the back-office logic (data, rules, admin, email, cron, MCP) fits the
sandbox well. The **public booking and signing UI cannot**. A sandboxed plugin cannot render HTML
pages (raw routes refuse `text/html`, JS, CSS and SVG), cannot inject scripts, and cannot define
Portable Text blocks. A signature pad and an interactive booking widget need browser JS. So any
"full featured" solution needs a **native companion package** for the front end, or site authors
must build their own pages against our public JSON API. The first-party `forms` plugin is native
for exactly this reason. It ships `./astro` (PT block `emdash-form` → `FormEmbed.astro`),
`./client` and `./styles`.

## 3. Sandboxed plugin anatomy

```
my-plugin/
  emdash-plugin.jsonc   # identity + trust contract (capabilities, allowedHosts, storage) + admin surfaces + release
  package.json          # version lives here for npm packages
  src/plugin.ts         # export default { hooks, routes, mcp } satisfies SandboxedPlugin
  tests/*.test.ts       # @emdash-cms/plugin-test hosts
```

- Scaffold: `pnpm dlx @emdash-cms/plugin-cli init <name>`.
- CLI commands: `init`, `build`, `dev`, `validate`, `bundle`, `publish`, `info`, `update-package`,
  `profile setup`, `release setup|plan|prepare`.
- Import types only, via `import type … from "emdash/plugin"`. The only value imports are
  lightweight helpers (`pluginRoute()`, `pluginResponse()`), and the CLI bundles them. Third-party
  pure-JS libraries such as `zod` get bundled. Node built-ins fail the bundle check.
- No constructor options. All configuration comes from `ctx.settings` / KV at runtime.

### 3.1 Manifest (`emdash-plugin.jsonc`)

- **Identity:** `slug` (lowercase, ≤64; also the route URL segment), `publisher` (pin a DID), `version`.
- **Profile:** `license`, `author(s)`, `security` contact (required), `name`, `description`
  (≤140), `keywords` (≤5), `sections` (CommonMark docs: description/installation/faq/changelog/security).
- **Trust contract:** `capabilities`, `allowedHosts`, `storage` (collections + `indexes` /
  `uniqueIndexes`). **Changing any of these requires a new version and renewed operator consent.
  Bump the major version for broadened access.** So declare only what each version uses.
- **Admin surfaces:** `admin.pages[]` (path/label/icon/group), `admin.widgets[]`
  (full/half/third), `admin.editorPanels[]`, `admin.editorActions[]`, `admin.fieldWidgets[]`,
  `admin.settingsSchema` (auto-generated settings form; `secret` fields are AES-GCM encrypted).
  A plugin that declares any page or widget **must** define a route named `admin`.
- **Release:** `repo` (public GitHub for automated releases),
  `release.requires` (`env:emdash`, `env:astro`, **or a package DID** with a semver range),
  `release.artifacts` (icon, banner, ≤8 screenshots; PNG/JPEG/WebP ≤1 MiB).

`release.requires` keyed by a **package DID** is the documented way for one registry package to
depend on another. It is the closest the platform has to "bundle" semantics.

### 3.2 Capabilities relevant to us

| Capability | Why we'd need it |
|---|---|
| `content:read` | Read the site's `events` collection entries (title, slug, dates, venue), `getPublicUrl()` |
| `schema:read` | Discover/validate the events collection and field mapping |
| `email:send` | Confirmations, reminders, signing invitations (needs an installed `email:deliver` transport) |
| `network:request` + `allowedHosts` | Stripe (`api.stripe.com`), Turnstile (`challenges.cloudflare.com`) |
| `media:read` / `media:bytes:read` | E-sign: read uploaded PDF templates (≤16 MiB per read) |
| `media:write` | E-sign: optionally store finished signed PDFs in the media library |
| `users:read` | Look up staff users (e.g. counter-signers, organisers) |
| `hooks.content-policy:register` | Optional: block publishing an event whose ticketing config is invalid. The docs say it covers the `content:beforePublish`, `beforeSchedule` and `beforeUnpublish` policy hooks; delete vetoes aren't mentioned |

No capability is needed for plugin-scoped **storage, KV, settings, logging and cron**.

### 3.3 Data APIs (all plugin-scoped, none shareable between plugins)

- `ctx.storage.<collection>`: document store with declared indexes. It provides `get/put/delete/exists`,
  `getMany/putMany/deleteMany`, `query({ where, orderBy, limit≤100, cursor })`, `count(where)`,
  and concurrency primitives:
  - `getVersioned` + `compareAndSet` / `compareAndDelete` (optimistic CAS),
  - **`updateIf(id, { where, set, delta: { field: { inc|dec } } })`**: an atomic guarded
    update with integer deltas. This is exactly what capacity/inventory control needs
    (`where: { sold: { lte: capacity - qty } }, delta: { sold: { inc: qty } }`).
  - Filters: equality, `in`, `startsWith`, `gt/gte/lt/lte`, on declared indexes only. Composite
    index order matters.
  - **`updateIf` guards are different** (confirmed in the storage docs, 2026-10-09): guard fields
    don't need declared indexes, because the update targets one document by ID. Guards compare
    fields to **literal** values only, with no field-to-field expressions. So `held + sold ≤ capacity`
    has to be stored as one counter (`reserved`) and compared to a literal `capacity − qty`.
  - Unique-index behaviour for documents missing the field isn't documented. Don't put a unique
    index on an optional field.
- `ctx.kv`: get/set/delete/list(prefix) + versioned CAS. Use it for cursors, counters, nonces and rate limits.
- `ctx.settings`: same API, backs the auto-generated settings form. `secret` fields are encrypted
  (`EMDASH_ENCRYPTION_KEY`) and fail closed.
- **Hard isolation:** *"A plugin can't read another plugin's KV or storage collections."* This
  rules out a shared database between the Events and e-sign plugins (see §6).

### 3.4 Content API constraints

- Plugins can read/write/publish content (capability-gated) but **cannot create or alter collection
  schemas** (`ctx.schema` is read-only). An "events" collection must therefore be defined by the
  site: by a seed, a starter template, or manual setup in the admin. The plugin can only detect it
  and validate it.
- `content:write` is coarse. It allows writing any content, so we should avoid requesting it.

### 3.5 Routes

- Mounted at `/_emdash/api/plugins/<slug>/<route>`. Handler: `(routeCtx, ctx)`. Route names may
  contain slashes for nested paths. Dots aren't documented, so avoid them. The slug must match
  `/^[a-z][a-z0-9_-]*$/`.
- **Private by default**: session or `admin`-scoped token + declared RBAC `permission`
  (default `plugins:manage`) + `X-EmDash-Request: 1` CSRF header for cookie auth.
  `routeCtx.user` carries the caller.
- `public: true` exposes a route to the internet. It needs install consent, and adding a public
  route later forces re-consent. We must do our own validation, rate limiting and anti-spam.
- Declare `methods` (host returns 405) and `request.body` mode (`json|text|bytes|form-data|none`,
  1 MiB default, 8 MiB max). Multipart is limited to 100 parts at 1 MiB per part.
- `cacheControl` on public GET routes (useful for event listings).
- Responses are wrapped in `{ success, data }`. `response: "raw"` + `pluginResponse()` can return
  bytes with allowlisted headers (`Content-Type`, `Content-Disposition`, `Location`, `ETag`…). **Raw
  routes cannot return HTML/JS/CSS/SVG/XML**, but they can return `application/pdf`,
  `text/calendar` and `text/csv`. `Location` allows redirects (e.g. to Stripe Checkout).
- `routeCtx.requestMeta`: trusted `ip` (when configured), `userAgent`, `referer`, Cloudflare `geo`.
  This is good input for signature audit trails.
- Credential, cookie and CSRF headers never cross into the sandbox. Public routes cannot see the
  visitor's session.

### 3.6 MCP tools

A private JSON route can be exposed as an MCP tool. It needs a Zod input schema, an explicit
permission and `destructive: true` for irreversible actions. Operators consent to tools at install
time, then enable them. Examples for our plugins: "list upcoming events", "check in attendee",
"export attendees", "send signing request", "void envelope".

### 3.7 Hooks available to sandboxed plugins

`plugin:install|activate|deactivate|uninstall`, `content:before/afterSave`, `before/afterDelete`,
`before/afterPublish`, `beforeSchedule`, `beforeUnpublish`, `afterUnpublish|Restore|Schedule|Unschedule`,
`media:before/afterUpload`, `email:beforeSend|deliver|afterSend`, `comment:*`, `byline:*`,
**`cron`**, **`page:metadata`**. Hooks support `priority`, `timeout`, `dependencies` (wait for named
plugins), `errorPolicy` (`abort|continue`) and `exclusive`.

- **There is no custom/plugin-defined event bus.** Plugins cannot emit hooks for other plugins.
- `cron`: `ctx.cron.schedule(name, { schedule, data })` with cron expressions or `@weekly`-style
  aliases. **One-shot tasks exist** (`is_oneshot` in `core/src/plugins/cron.ts`, 5 retries) **[verify
  the exact one-shot `schedule` string format]**. Use this for reminders, hold expiry, signing
  reminders and retention purges.
- `page:metadata` lets us emit schema.org `Event` JSON-LD (with `offers`, `eventStatus`,
  `location`) for every event page. That is free SEO, and it works in the sandbox.

### 3.8 Admin UI (Block Kit)

- Blocks: header, section, divider, fields, **table** (sortable/paginated), actions, **stats**,
  **form** (conditional fields), image, context, columns, **chart** (timeseries/pie/custom ECharts),
  code, meter, banner, empty, tabs, accordion.
- Elements: button (with confirm), link, menu, text/number/date inputs, select, `combobox`,
  checkbox, radio, toggle, secret_input, **repeater** (good for ticket types and custom questions),
  `media_picker`, plus dynamic `optionsRoute` selects.
- **Editor panels/actions** on saved entries: a "Tickets & bookings" panel directly on the event
  entry. `collections` scope is optional, but required if the panel reads draft fields.
- **Declarative field widgets** (`text_input`, `number_input`, `toggle`, `select`, `media_picker`,
  stored as a JSON field). An "event picker" or "booking settings" field is possible. The docs warn
  that end-to-end save is only proven for `json` fields.
- Interactions arrive as `page_load` / `block_action` / `form_submit` on the `admin` route.
  Responses can include a `toast`. The admin UI is stateless and server-driven. There is no
  client JS, no drag-and-drop and no canvas, so **a PDF field-placement designer is not possible
  in Block Kit**. That would need native React admin.

### 3.9 Email

`ctx.email.send({ to, cc?, replyTo?, subject, text, html? })`. **No attachments** and one `to`
address per call. Tickets, `.ics` files and signed PDFs must be delivered as **links** to raw
routes protected by expiring signed tokens. It only works when an email transport plugin
(`email:deliver`) is installed, so the plugin must degrade gracefully and show a setup banner when
none is installed.

### 3.10 Runtime limits (critical)

| Limit | Value | Cloudflare | Node/workerd |
|---|---|---|---|
| CPU | **50 ms / invocation** | Enforced | Not enforced |
| Subrequests | **10 / invocation** ("fetch/service-binding calls") | Enforced | Not enforced |
| Memory | 128 MB | Platform ceiling | Not enforced |
| Wall time | 30 s | Enforced | Enforced |
| `ctx.http.fetch` body | 8 MiB buffered | | |
| Route body | 1 MiB default / 8 MiB max | | |
| Media byte read | 10 MiB default / 16 MiB max | | |

**[verify] Whether each `ctx.storage`/`ctx.kv`/`ctx.content` bridge call counts as a subrequest.**
The bridge is a `PluginBridge` service-binding RPC. If each call counts, a single route invocation
can make **at most ~10 host API calls**. That strongly shapes design: batch with
`getMany/putMany`, denormalise, and keep per-request round trips small. This is the #1 spike.

50 ms CPU rules out heavyweight work inside the sandbox on Cloudflare: generating or stamping PDFs
with a general library, rasterising signatures, expanding large recurrence sets. Hashing (SHA-256
via WebCrypto) and HMAC are cheap. Sandboxed plugins also require the **Workers Paid plan** on
Cloudflare (Worker Loader binding `LOADER` + `PluginBridge` export).

### 3.11 Testing

`@emdash-cms/plugin-test` + `emdashPluginTest()` Vitest plugin (builds first, real D1 + Worker
Loader bindings):
- `createPluginTestHost()` is fast. It covers hooks, routes, KV, settings, storage, manifest and
  capability enforcement. `invokeRoute()` bypasses auth/CSRF/caching.
- `createPluginRuntimeTestHost()` is the real host. It covers content actions, auth/permission/CSRF
  via `host.actions.routes.request()`, scheduling, Block Kit validation and editor panels
  (`captureEditorDraft`, `applyEditorDraftPatch`).
- `host.http.respond()` / `host.http.requests()` fake outbound HTTP (Stripe, Turnstile).
- Neither host reproduces the CPU or subrequest limits. Those need a deployed staging site.

### 3.12 Publishing & distribution

- Manual: `emdash-plugin login <handle>` → `emdash-plugin publish`.
- Automated: `emdash-plugin release setup` generates `.github/workflows/emdash-release.yml`. It
  publishes via GitHub OIDC with Sigstore provenance and needs no secrets. It supports **Changesets**
  and works from a **monorepo** (one workflow; tags `<slug>@<version>`, `profile setup --dir`
  per extra package). It requires a **public GitHub repo**.
- Registry moderation reviews the listing metadata. Install verifies the checksum, declared access
  and provenance, then shows a consent dialog with the exact capabilities, public routes and MCP tools.
- Native companion packages are published to **npm** separately.

## 4. Reference implementations worth copying

| Plugin | Format | What to borrow |
|---|---|---|
| `packages/plugins/forms` | Native | Public submit route + Turnstile verification via `ctx.http`, PT block `emdash-form` → `FormEmbed.astro` that SSR-loads data via `getPublicPluginApiRouteHandler(Astro.locals)` (in-process call to a plugin's **public** route), progressive-enhancement client script, CSV export, cron digests/cleanup. |
| `packages/plugins/webhook-notifier` | Sandboxed | Minimal Block Kit admin + tests (`admin-blocks.test.ts`). |
| `packages/plugins/atproto` | Sandboxed | Larger sandboxed plugin with runtime tests (`plugin-runtime.test.ts`) and admin routing. |

`emdash/plugin-utils` → `getPublicPluginApiRouteHandler(locals)` lets **SSR Astro components call
any plugin's public route in-process**, by plugin ID. It takes no network round trip and needs no
capability. **[verify] that it dispatches to sandboxed plugins as well as native ones.** The
signature is `(pluginId, method, path, request)` on `EmDashHandlers`. This is the key enabler for a
native front-end layer over sandboxed back ends.

## 5. Payments landscape

- EmDash core has **no commerce/payments layer**. `@emdash-cms/x402` is an HTTP-402 content
  paywall (crypto micropayments). It does not fit ticket sales.
- Paid tickets therefore mean integrating a provider ourselves. **Stripe Checkout** (hosted page)
  fits the sandbox well:
  1. A public route creates a Checkout Session via `ctx.http.fetch("https://api.stripe.com/…")`
     (`network:request`, `allowedHosts: ["api.stripe.com"]`). That is one subrequest.
     Stripe requires the session's `expires_at` to be **30 min–24 h after creation**, so a
     checkout hold shorter than 30 minutes can't be passed straight through.
  2. The visitor is redirected (raw route `Location` or JSON `url`).
  3. A public `webhooks/stripe` route verifies `Stripe-Signature` with WebCrypto HMAC-SHA256.
     This requires declaring the `stripe-signature` request header and reading the **raw** body
     (`request.body: "text"`).
  4. Refunds go through the Stripe API from an admin route.
- Keep the payment provider behind an interface so PayPal/Square/etc. can be added later. Each
  provider widens `allowedHosts`, which means a new major version and re-consent.

## 6. Inter-plugin communication: the core design problem

Requirement: the **e-sign plugin must be independent** (useful on its own for contracts, consent
forms, NDAs), and the Events plugin must be able to **require a signed waiver/agreement as part of
booking** when both are installed ("bundled").

What the platform does **not** offer between sandboxed plugins:
- No shared storage/KV.
- No plugin-to-plugin RPC or custom hooks/event bus.
- `ctx.http.fetch` to our own site needs our own hostname in `allowedHosts`, which is unknowable
  at publish time. The alternative is `network:request:unrestricted`, which over-asks.

What it **does** offer:
1. **Browser-mediated handoff**: public routes on both plugins plus redirects (OAuth-style).
2. **SSR in-process calls** to public routes via `getPublicPluginApiRouteHandler` from a native
   companion Astro component.
3. **Shared cryptographic trust**: HMAC (or Ed25519) via WebCrypto, with keys stored as `secret`
   settings.
4. **`release.requires` on a package DID** so a bundle package can declare that it needs both.

**Recommended pattern: a "signing intent / signed receipt" protocol.**

```
Events (public route)                     E-sign (public routes)
───────────────────────                   ──────────────────────
booking created (status: awaiting_signature, capacity HELD with TTL)
issue SigningIntent = HMAC(clientSecret, {
  v, clientId, templateId, externalRef: bookingId,
  signer: {name,email}, prefill, returnUrl, exp, nonce })
        ──── browser redirect / SSR call ────►  POST envelopes/from-intent
                                                verify HMAC + exp + nonce (KV, single use)
                                                create envelope → signingUrl
        ◄─── redirect signer to signing page ───
                                                signer completes ceremony
                                                SignedReceipt = HMAC(clientSecret, {
                                                  envelopeId, externalRef, status,
                                                  documentSha256, completedAt })
        ◄──── redirect to returnUrl?receipt=… ──
POST signatures/receipt
verify HMAC → booking confirmed, hold → sold
```

- **Pairing:** in the e-sign admin, "Add integration client" generates `clientId` + a random
  secret, shown once as a pairing string (`esign1.<clientId>.<secret>`). The operator pastes it
  into the Events setting `esignPairing` (a `secret` field). The bundle package can automate this.
- **Reconciliation:** the signer may close the tab after signing. Then (a) the Events companion
  "booking status" component, during SSR, calls e-sign's public `receipts/lookup` (HMAC-authed
  request) in-process and forwards the receipt to Events. (b) The confirmation email links to that
  status page. (c) An admin "Refresh status" action can accept a receipt pasted or fetched by the
  companion. Neither sandboxed plugin needs network capability for any of this.
- **Generic by design:** e-sign knows nothing about events. Any system that holds a client secret
  can request signatures and verify receipts. That keeps e-sign independently useful and
  testable, and lets the protocol be documented publicly.

## 7. E-signature domain notes

Not legal advice. Have counsel review before claiming compliance.

- Target **simple electronic signatures (SES)** as in ESIGN Act / UETA (US) and eIDAS SES (EU/UK).
  Do **not** claim advanced or qualified signatures (AES/QES), which need certificate-based identity.
- Elements that make SES defensible:
  1. **Intent to sign**: explicit action (type name / draw), clear "Sign" button.
  2. **Consent to do business electronically**: ESIGN disclosure checkbox, recorded.
  3. **Association of signature with record**: the signature is bound to a SHA-256 hash of the
     exact document snapshot presented.
  4. **Record retention & reproducibility**: immutable snapshot, downloadable signed copy,
     certificate of completion.
  5. **Attribution / identity**: email ownership (signing link sent to email and/or OTP), IP, user agent,
     timestamps, geo (from `requestMeta`).
  6. **Tamper evidence**: hash-chained audit events (`hash_n = SHA256(hash_{n-1} || event)`) plus
     a final envelope hash in the certificate.
- Common features in the market (DocuSign/Dropbox Sign/DocuSeal/Documenso baseline): templates,
  multiple signers, signing order, field types (signature, initials, date, text, checkbox),
  reminders, expiry, decline, void, audit trail, certificate of completion, bulk send, embedded
  signing, webhooks.
- **Sandbox fit:**
  - Text/Markdown agreement templates rendered to an immutable snapshot fit easily, and are ideal
    for event waivers.
  - Drawn signatures should be captured client-side as **vector stroke JSON** (small, hashable,
    renderable as PDF path operators without rasterising).
  - PDF output is CPU-sensitive (50 ms). Options: a minimal hand-written PDF writer for the
    certificate and text agreements (cheap, no dependencies); or stamp uploaded PDFs in the
    **native companion** (in-process, no CPU cap) or in a later phase after measuring `pdf-lib` cost.
  - A visual PDF field placer needs native React admin. Defer it, or use a coordinate-entry
    fallback in Block Kit.
  - Storing signed artefacts: plugin storage (base64 chunks) vs media library (`media:write`;
    media URLs are authenticated, but every admin with `media:read` can see them). Decide in a spike.
    PII retention should be configurable and purged by cron.

## 8. Events-booking domain notes (feature baseline)

Benchmarks: The Events Calendar + Event Tickets (WP), Eventbrite, Tito, Pretix, Amelia.

- Events (single, multi-day, **recurring** via RRULE with exceptions), venues, organisers,
  timezone-correct display.
- Ticket types: price, currency, capacity per type + overall event capacity, sale windows,
  min/max per order, hidden/unlockable tickets, **promo codes**, tax-inclusive pricing note.
- Booking flow: select tickets → attendee details (**custom questions** per event) → optional
  waiver (e-sign) → payment (free/Stripe) → confirmation.
- Inventory: **holds with TTL** during checkout; atomic decrement; oversell prevention.
- **Waitlist** with auto-offer on cancellation (time-limited claim link).
- Attendee management: list/search/export CSV, manual add, cancel/refund, transfer, notes.
- **Check-in**: unique ticket codes (QR on the ticket page), staff check-in screen, MCP tool.
- Communication: confirmation, reminder (T-24h etc.), update/cancellation broadcast, waitlist
  offers. All via `ctx.email` with links (no attachments).
- Calendar: `.ics` download per booking/event (raw route `text/calendar`), Google/Outlook add links.
- SEO: schema.org `Event` JSON-LD via `page:metadata`.
- Reporting: sales/attendance stats and charts in Block Kit widgets.
- Privacy: retention period, attendee data deletion on request, IP hashing.

## 9. Key constraints → design decisions

| Constraint | Decision |
|---|---|
| Sandbox can't render public UI or PT blocks | Split each plugin into **sandboxed core (registry)** + **native Astro UI kit (npm)** |
| Plugins can't create collections | Site supplies an `events` collection; ship a seed/schema snippet; plugin validates via `schema:read` and stores booking config in its own storage keyed by entry ID |
| No inter-plugin storage/RPC | **Signing-intent / signed-receipt** HMAC protocol over public routes + SSR in-process calls |
| 10 subrequests / 50 ms CPU | Batch storage calls, denormalise counters, one Stripe call per request, no heavy PDF libs in sandbox, cron work in small cursor-driven batches |
| No email attachments | Signed, expiring links to raw routes for tickets, ICS and PDFs |
| Trust contract changes force re-consent | Plan capabilities per version up front; payments/esign-linking as declared from v1 where sensible |
| Public routes are unauthenticated | Turnstile, KV rate limits, opaque unguessable tokens, minimal data in responses |

## 10. Open questions to resolve in spikes

1. Do bridge calls (`ctx.storage`, `ctx.kv`, `ctx.content`) count toward the 10-subrequest limit
   on Cloudflare? (This drives the whole data-access design.)
2. Does `getPublicPluginApiRouteHandler` dispatch to **sandboxed** plugins' public routes?
3. One-shot cron `schedule` format, and cron granularity / max tasks per plugin.
4. Max size of a single `ctx.storage` document (for snapshots and signature artefacts).
5. CPU cost of `pdf-lib` stamping a 1–3 page PDF in a Dynamic Worker.
6. Can a native companion's Astro component be registered as a PT block for a **sandboxed**
   plugin's data (i.e. a native plugin whose only job is `componentsEntry` + `portableTextBlocks`)?
7. Slug uniqueness across publishers on one site: is `events` safe, or should we namespace
   (`semics-events`)?

## 11. Competitive landscape (checked 2026-10-10)

The registry listed 65 plugins on 2026-10-10. None sells tickets, takes bookings, or collects
e-signatures, waivers or contracts. npm, GitHub and the community "awesome-emdash" lists showed
the same.

| Plugin | Distribution | What it does | What it lacks |
|---|---|---|---|
| [Eventual](https://github.com/Vermeulen-Solutions/eventual-emdash-sandbox) (Vermeulen Solutions, 2 stars) | Registry, sandboxed, MIT | Events as native content, recurrence, venues, JSON and iCal feeds, JSON-LD, MCP tools; front end is example Astro views | Tickets, bookings, RSVP, payments, check-in |
| [Dateline](https://github.com/foreztgump/dateline-events-plugin) (1 star, v0.3.0) | npm: 3 sandboxed plugins (`core`, `rsvp`, `importer`) + native `@dateline/views` | Events, venues, organisers, feeds, importer (incl. The Events Calendar), **free RSVP with capacity, waitlist and confirmation email** | Paid tickets (planned via the author's Tender payments plugins), check-in, waivers |
| [DashCommerce](https://github.com/emdashCommerce/dashcommerce) and other commerce plugins | npm | General shops: products, inventory, checkout | Capacity holds, attendees, check-in |
| Payments (HandyPlugins) | Registry | One-off payments | Event-specific features |

**Paid plugins.** The registry is free-only. Cloudflare's 1.0 post (2026-09-28) says paid plugins
are a goal under the same decentralised model, with no timeline. Two registry plugins already
advertise Pro tiers (Auto Unpublish Posts, Discord Notifier). Stranger Studios, the makers of Paid
Memberships Pro for WordPress, publishes on EmDash.

**Ecosystem size.** The `emdash-cms/emdash` repo has 13.5k stars and 1.3k forks. Cloudflare reports
175+ contributors and 800+ Discord members. Small, but early.

**Platform note.** [Issue #4004](https://github.com/emdash-cms/emdash/issues/4004) (opened
2026-10-08 by Eventual's developer) treats content and KV bridge calls as counting toward the
10-subrequest limit, from local probes. That supports the two-call checkout design; Spike S1
still needs a deployed measurement.

**Packaging precedent.** First-party sandboxed plugins publish to npm with `.` and `./sandbox`
exports; the native `forms` plugin adds `./astro`, `./client` and `./styles`. Dateline uses the
same core-plus-native-views split as this plan.

## Sources

- EmDash repo: https://github.com/emdash-cms/emdash
- Official plugin skill: https://cdn.jsdelivr.net/gh/emdash-cms/emdash@HEAD/skills/creating-plugins/SKILL.md
- Docs pages read (repo paths): `plugins/overview`, `plugins/creating-plugins/{choosing-a-format,manifest,capabilities,storage,hooks,api-routes,block-kit,settings,testing,publishing,cli,delegated-releases}`,
  `plugins/{installing,registry}`, `plugins/creating-native-plugins/*`, `deployment/plugin-sandbox`, `guides/x402-payments`.
- Code read: `packages/core/src/plugin-utils.ts`, `packages/core/src/plugins/{types,cron}.ts`,
  `packages/cloudflare/src/sandbox/runner.ts`, `packages/plugin-types/src/manifest-schema.ts`,
  `packages/plugins/forms/**`.
