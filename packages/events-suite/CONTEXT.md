# Suite package context

Read this instead of BUILD-PLAN.md (§3.5 is the spec); open a BUILD-PLAN section only when your task's `spec` cites it.

## What it is

`@semics-tech/emdash-events-suite` (MIT, Free, `"private": true` until the first release PR): wiring only.
No sandboxed core, no capabilities, storage, routes or business rules (tests/boundaries.test.ts). It
bundles nothing new into the cores; it calls them through their public routes in-process.

- `src/index.ts` (tsc → `dist/ts`, imported by `astro.config.mjs`): `eventsSuite({ events?, esign? })` →
  `{ sandboxed, plugins, integrations, pluginIds }`. A core is a descriptor (npm: the product's default
  export, or a Pro build) or `{ pluginId: "r_…" }` (registry install, not added to `sandboxed`). The id is
  the descriptor's `id` or the given one, never a literal; it goes to `eventsIntegration({ pluginId,
  esignPluginId })`, `esignIntegration({ pluginId })` and `suiteIntegration(ids)` (virtual module
  `virtual:semics-events-suite/config`: `eventsPluginId`, `esignPluginId`), which injects `/_events/waiver`.
- `src/astro` (ships as source): `BookingWithWaiver.astro` (the form), `WaiverPage.astro` (`/_events/waiver`),
  `lib/form.ts` (form reading, C0 check, widget error round trip `?waiver_error=&waiver_fields=&waiver_event=`),
  `lib/flow.ts` (`handleWaiverRequest`: the page logic, returns redirect / render / error / forbidden).
- Imports only the products' public entries: `/ui`, `/integration`, `/astro/*.astro`, and `/astro/lib/*`
  (both product packages export their UI helpers there since T065). Never `@semics-tech/shared` (R35;
  `scripts/ui-imports.test.mjs` scans all of `src`).

## The flow (`lib/flow.ts`)

1. Book (`intent=book`): reserve → continue with `attendees` (`minor: true` from the "under 18" box).
   A refused continue cancels the held booking (`public/booking/cancel`) and returns to the widget.
   `next.type`: `done` → `/booking?ref=`; `pay` → the provider URL (Phase 4 slot, `FLOW_STEPS`);
   `sign` → every intent to E-sign `public/envelopes/from-intent` (email: `sent`/`draft`/`in_progress`/
   `completed` all fine; inline: `signingToken`). Inline tokens → cookie `semics_waiver_<ref>` (dot-joined,
   HttpOnly, SameSite=Strict, path `/_events/waiver`, 60 min) → `/_events/waiver?ref=`.
2. Sign: GET renders the first token's ceremony (`handleSign` with the E-sign id; a GET never opens the
   envelope); a closed one (signed elsewhere) is forwarded and skipped. The ceremony's posts come back here;
   when it ends, the receipt (fragment of `ceremonyRedirect(view)`) goes to Events `signatures/receipt` via
   Events' `forwardReceipt` in-process (no JS needed), then the next token, or after the last / a decline
   `/booking?ref=&waiver=…`. With an access cookie, every GET/POST first reads `public/booking` (`readBooking`): an
   expired/cancelled/declined/refunded booking, or a lapsed hold, is `error` `BOOKING_EXPIRED` (message, "Book again" link to
   `/events/<slug>` when `event.slug` is known, no ceremony, e-sign never asked, T151). The render outcome carries that answer
   so `lib/slot.ts` (title and booked date, T148) reuses it: `event` from `public/booking`, else `public/event`. The page sends `ceremonyCsp()` and renders nothing else inline (no own styles).

   After the last receipt (`waiver=signed`) `payOrLand` continues the booking again (no attendees) and follows a `pay` step (T077);
   anything else lands on `/booking`. The token for that comes from the `semics_waiver_access_<ref>` cookie (waiver path, set
   when the flow goes to sign, cleared when it leaves this page: last signer, a decline, or continue answering
   `done`/`pay`/only email signers, T119 F13). Return paths resolving to `//host` are refused (`safeReturnPath`, F11).
   A waiver refusal of the order (`WAIVER_EMAIL_REQUIRED`, `WAIVER_TOO_MANY_EMAILS`, R48) goes back to the widget with its message.
3. Retry (T066, `intent=retry`): E-sign refusing an intent leaves the booking held and sends the browser to
   `/_events/waiver?ref=&error=SIGNING_UNAVAILABLE`, which shows a "Try again" form. It continues the booking
   again with the `semics_booking_<ref>` cookie and no `attendees` (Events keeps the stored ones; Pro skips
   signed seats) and redeems the intents again; a lapsed hold comes back as `error=HOLD_EXPIRED`.
4. Plain events: `public/event` says `waiver: true` only when a waiver is required. `<BookingWithWaiver>` shows
   attendee rows then; otherwise a ticket select and quantity (`plain=1`, `readWaiverForm` → `attendees: []`,
   continue is sent without `attendees`).

5. After booking (T133, R95): the attendee signing list (Signed / Waiting, Sign now, Resend, edits until the cutoff) lives on
   Events' `/booking` page (`src/astro/lib/attendees.ts` in the Events package), not here: it needs only `esignPluginId`, which
   `eventsSuite()` passes to `eventsIntegration`. Sign now goes through Events' `startDoorSigning` to e-sign's `/sign/<token>`, not
   through `/_events/waiver`; its receipt comes back on `/booking` like the door link's.

## Reconciliation and catalogue (T066)

- `lib/reconcile.ts` `reconcileBooking`: run by Events' `/booking` page (through the virtual module's `reconcile`,
  set by `eventsIntegration({ reconcile })`) when `public/booking` carries `waiver.lookups`: asks E-sign
  `public/receipts/lookup` per lookup request (max 10, in parallel) and forwards each terminal receipt with
  `forwardReceipt`; the page then re-reads the booking. Events stores a receipt once and never replaces a
  completed one, so a second visit changes nothing. Free lists no requests: no calls. Errors are swallowed.
- `lib/templates.ts` `refreshCatalogue` and `TemplatesPage.astro` (`/_events/templates`): the panel's Refresh
  templates (Pro) links to `/_events/templates#catalog=<request>`; Events' `receipt.ts` client script posts it
  from the fragment; the page asks E-sign `public/templates/catalog`, then Events (Pro) `esign/catalog`, which
  re-verifies the request (minted by this site, <= 5 minutes) and caches the well-formed templates for the
  panel's select. Both lookup and catalogue tokens are minted by the Events Pro core, never here.

## Auto-pairing (T145, `/_events/pair`)

Sandbox facts (EmDash 1.2, checked in `emdash/dist`): a sandboxed core reaches only its own settings,
storage and KV (scoped by plugin id) and cannot call another plugin's routes, so neither core can pair
the other. Site pages are native: for a signed-in visitor `locals.emdash.handlePluginApiRoute` runs any
route of a plugin, private ones too, in process with the caller we pass (it skips the HTTP dispatcher's
`plugins:manage`/CSRF check, so the caller must check); anonymous visitors only get
`handlePublicPluginApiRoute`. Plugin settings are written by the host's own handler (`GET`/`PUT` of
`emdash/internal/routes/api/admin/plugins/_id_/settings`): it checks `plugins:manage` on `locals.user`,
validates against the manifest, encrypts secrets, merges only the keys sent (`null` deletes) and masks
secrets in answers (`secretsSet`). The sandbox strips `cookie`, `authorization` and `x-emdash-request`
from a route's headers but keeps `origin` and `sec-fetch-*`.

Design: `PairPage.astro` + `lib/pair.ts`. GET: the host's settings read (the admin check) says whether
Events holds `esignPairing`; E-sign's private `integrations/pair` `status` says whether its site client is
active → `paired` / `unpaired` / `revoked` / `esign-missing` / `forbidden` / `error`. One POST
(`action=pair`, cross-site posts refused) asks E-sign `pair` (as the admin, with a fresh server-side
`Request`: no browser headers) and writes the returned string with the host's settings write; PRG to
`?result=`. The string is only in that request's memory: no response, URL, cookie or log. `unpair`
revokes the client and deletes the setting (Events' "pairing" waiver state). When the host says E-sign is
not there (`NOT_FOUND` "Plugin not enabled/found"), a GET clears a leftover pairing (it cannot work).
E-sign's route refuses non-admins and any request with `Origin`/`Sec-Fetch-*`, so an admin's browser
cannot read a pairing string from it either; re-running reuses the one client (id in E-sign KV). The
manual flow (E-sign Integrations → paste into Events settings) is unchanged.

Hand-made pairings (T149): the page reads Events' stored string server side with emdash's public
`getPluginSetting(eventsPluginId, "esignPairing")` (it decrypts; only after the admin check), keeps only
the client id and sends it as `clientId` to every E-sign action. So a pasted pairing shows as `paired`,
and Pair adopts that client (E-sign revokes the auto-pair client it replaces) instead of minting a second.

## Tests

`tests/*.test.ts`, plain Node vitest: the flow runs the real UI helpers of both products against a fake
`locals.emdash.handlePublicPluginApiRoute`; the "Pro" signature answers are faked there, because the
playground (public repo) never loads Pro. Playground e2e `e2e/t065-booking-with-waiver.spec.ts`: Free
booking through the widget, the C0 refusal, and the waiver page's ceremony with an intent minted like Pro.
