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
   `/booking?ref=&waiver=…`. The page sends `ceremonyCsp()` and renders nothing else inline (no own styles).

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

## Tests

`tests/*.test.ts`, plain Node vitest: the flow runs the real UI helpers of both products against a fake
`locals.emdash.handlePublicPluginApiRoute`; the "Pro" signature answers are faked there, because the
playground (public repo) never loads Pro. Playground e2e `e2e/t065-booking-with-waiver.spec.ts`: Free
booking through the widget, the C0 refusal, and the waiver page's ceremony with an intent minted like Pro.
