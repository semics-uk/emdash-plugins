---
id: T065
title: "Suite: package and BookingWithWaiver flow"
phase: 3
package: suite
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T062, T064, T055, T030]
spec: [SX-FR-01, SX-FR-02, SX-FR-03]
---

# T065 · Suite: package and BookingWithWaiver flow

## Definition

Create `@semics-tech/emdash-events-suite`: `eventsSuite()` config helper and `<BookingWithWaiver>` running reserve → inline signing → receipt → done.

## Model

**Opus 5.5**: Cross-package orchestration.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] `eventsSuite()` returns the expected sandboxed and plugins arrays
- [x] Playwright: waiver booking completes in one page flow
- [x] Payment step slot exists for Phase 4

## Implementation (green, then refactor)

- `packages/events-suite/`

## Acceptance criteria

- [x] No business logic in the suite
- [x] `eventsSuite()` passes each core's plugin ID to both UI entries and the pairing glue; no hard-coded slugs (S7, T005)
- [x] The suite's `from-intent` caller treats an email intent's `draft` answer like `sent` (T062/T063); the booking widget gets an "under 18" control per attendee for waiver events; attendee names are checked for C0 control characters before intents are issued (e-sign refuses them)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events-suite verify
pnpm --filter playground e2e
```

## Notes

- **Package location.** `packages/events-suite` (this task file, BUILD-PLAN §2 repo layout and the module
  boundaries table), not `packages/suite`. MIT, Free, `"private": true` until the first release PR; the release
  dry-run picks it up (non-plugin package: package.json, LICENSE, README.md). `.` is tsc output (`dist/ts`,
  imported by `astro.config.mjs`), `./astro` ships as source. Depends on both product packages (`workspace:*`).
- **`eventsSuite({ events?, esign? })`** → `{ sandboxed, plugins, integrations, pluginIds }`. A core is a
  descriptor (default: the product's Free descriptor; a Pro build passes its own) or `{ pluginId: "r_…" }` for a
  registry install (left out of `sandboxed`). Ids come from the descriptor's `id` or the given value, are checked
  as route segments, and go to `eventsIntegration({ pluginId, esignPluginId })` (T064's door page and receipt
  lookup now get the e-sign id), `esignIntegration({ pluginId })` and `suiteIntegration` (virtual
  `virtual:semics-events-suite/config`, injects `/_events/waiver`). `integrations` is an addition to the
  `sandboxed`/`plugins` pair BUILD-PLAN §3.5 names: the pages need Astro integrations. The playground is now
  wired by `eventsSuite()`.
- **Flow (`src/astro/lib/flow.ts`).** The widget posts to `/_events/waiver`: reserve → continue with
  `attendees` (`minor: true` from the per-row "under 18" box) → `done` booking page / `pay` provider URL (the
  Phase 4 slot, `FLOW_STEPS`) / `sign`: every intent to e-sign `from-intent`, email answers `sent`, `draft`,
  `in_progress`, `completed` all accepted. Inline signing tokens are kept in an HttpOnly, SameSite=Strict
  cookie `semics_waiver_<ref>` scoped to `/_events/waiver` (60 min), never in a URL: E-sign's
  `<SigningCeremony>` forms carry no token field, so the page needs the token server-side for each post.
  The page renders the ceremony under `ceremonyCsp()` (no own styles or scripts), and its posts run E-sign's
  `handleSign`. **Deviation from T064's note** ("redirect to `ceremonyRedirect(view)`"): the suite takes the
  receipt from `ceremonyRedirect(view)` and forwards it in-process with Events' `forwardReceipt`, then shows the
  next signer or lands on `/booking?ref=&waiver=…`. Same protocol result (§8.2 allows a host that renders the
  ceremony to use the view's URL), but works without JavaScript and keeps several inline signers (buyer + minors)
  on one page; a 303 to `/booking#receipt=` would leave the flow after the first signer.
- **C0 check** (`readWaiverForm`): buyer name, attendee names and emails with U+0000-U+001F or U+007F are refused
  (`CONTROL_CHARACTERS`, fields named, no values in the URL) before reserve, so no seats are held and no intent
  is minted. A continue refusal (e.g. Pro's `WAIVER_EMAIL_REQUIRED`) cancels the held booking
  (`public/booking/cancel`) and returns to the widget with the rows to fix.
- **Exports added to both products:** `./astro/lib/*` → `src/astro/lib/*.ts` (the suite composes
  `callPublicRoute`, cookie/CSRF helpers, `forwardReceipt`, `handleSign`, `ceremonyRedirect`, `ceremonyCsp`
  without importing `.astro` files). Changesets: suite minor, events/esign patch. CONTEXT files updated.
- **Pro path tested without Pro.** The playground cannot load Pro, so in the e2e the flow degrades to a plain
  booking (Free ignores waivers). The signing half is tested two ways: `tests/flow.test.ts` drives the whole flow
  (book → intents → ceremony → receipt → next signer → confirmed, decline, closed-in-another-tab, refusals)
  through the real UI helpers against a faked host whose continue answers like the Pro signature step; and
  `e2e/t065-booking-with-waiver.spec.ts` signs on `/_events/waiver` with an intent minted like Events Pro
  (cookie set by the test) and checks the CSP, no token in any URL, the cookie cleared and the envelope
  terminal. Free's `signatures/receipt` is a stub, so that run lands on `waiver=failed`; with Pro it confirms.
- **Test evidence.** Red: the suite tests failed on missing `src/index` / `src/astro/lib/form` modules and the
  ui-imports script on "no UI sources found in packages/events-suite"; the e2e spec was written first but not
  run red (no page existed; a build is ~1 min). Green: 39 suite tests, ui-imports 3/3, playground e2e 61/61.
- **Follow-ups.** (1) Phase 4: after the last receipt a paid booking is `awaiting_payment`, and the booking page
  has no pay link yet; calling continue again there without `attendees` would replan unsigned seats in the
  buyer's name (`planAttendees` with no input), so the pay step after signing needs an Events seam that keeps
  stored attendees (as `keepSigned` does for signatures). (2) If an intent is refused mid-flow the booking stays
  held with no retry button; T066 reconciliation could offer one. (3) `public/event` does not say whether an
  event needs a waiver, so `<BookingWithWaiver>` always shows the attendee rows; the site places it on waiver
  events.
