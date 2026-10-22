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

## Tests

`tests/*.test.ts`, plain Node vitest: the flow runs the real UI helpers of both products against a fake
`locals.emdash.handlePublicPluginApiRoute`; the "Pro" signature answers are faked there, because the
playground (public repo) never loads Pro. Playground e2e `e2e/t065-booking-with-waiver.spec.ts`: Free
booking through the widget, the C0 refusal, and the waiver page's ceremony with an intent minted like Pro.
