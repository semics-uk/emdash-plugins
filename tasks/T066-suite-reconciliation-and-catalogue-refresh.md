---
id: T066
title: "Suite: reconciliation and catalogue refresh"
phase: 3
package: suite
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T065]
spec: [SX-FR-05, SX-FR-07]
---

# T066 · Suite: reconciliation and catalogue refresh

## Definition

`<BookingStatus>` fetches missing receipts and forwards them; the Events panel's Refresh templates calls the catalogue.

## Model

**Sonnet 5.5**: Wiring with clear tests.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Closed-tab scenario reconciles on status page load
- [x] Forwarding twice changes nothing
- [x] Catalogue refresh populates the select

## Implementation (green, then refactor)

- `packages/events-suite/src/astro/lib/reconcile.ts` (see Notes for the path)

## Acceptance criteria

- [x] Within budget
- [x] If e-sign refuses an intent mid-flow, offer a retry instead of leaving the booking held (T065); `public/event` says whether a waiver is required so `<BookingWithWaiver>` shows attendee rows only when needed
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events-suite verify
pnpm --filter playground e2e
```

## Notes

- **Path deviation.** `reconcile.ts` lives in `src/astro/lib/` with the other flow code (shipped as source, processed
  by Vite like `flow.ts`), not `src/reconcile.ts` (which would compile to `dist/ts` and import `.ts` sources).
  Events' `/booking` page reaches it through the virtual config module: `eventsSuite()` passes
  `eventsIntegration({ reconcile: "@semics-tech/emdash-events-suite/astro/lib/reconcile" })`, which re-exports it as
  `reconcile` (`null` without the suite). Events imports nothing from the suite.
- **Where tokens are minted.** Lookup and catalogue requests are signed by Events Pro (the pairing secret lives
  there; `src/waivers/lookups.ts`, `catalogue.ts` in the Pro repo). The public side is seams only:
  `bookingStatusRoute(lookups)` (`public/booking` lists `waiver.refs`, and with Pro `waiver.lookups`), and the
  `waivers` check may return `templates` and `refresh()` for the panel. Free lists refs only, so reconciliation
  makes no calls and the Free path stays a plain booking.
- **Catalogue refresh.** The sandboxed core cannot reach E-sign, so the panel's Refresh templates button (Pro) shows a
  link to `/_events/templates#catalog=<request>` (suite page; fragment, never a URL token; 5 minutes). The page asks
  E-sign `public/templates/catalog` in-process and posts the list to the Pro route `esign/catalog`, which re-verifies
  that request with the pairing secret before caching the well-formed templates in KV; the panel's template field is
  then a select (the saved template stays selectable). Two clicks (button, then link) because a link minted at panel
  load would be stale after 5 minutes. The host's acceptance of an external link target is only checked by the
  Block Kit validator in the Pro editions test, not in a real admin.
- **Retry.** E-sign refusing an intent sends the browser to `/_events/waiver?ref=&error=SIGNING_UNAVAILABLE`, which now
  shows "Try again" (`intent=retry`): continue again with the booking cookie and no attendees. Events keeps the stored
  attendees on such a retry (new: previously it replanned them in the buyer's name, T065 follow-up 1), Pro skips signed
  seats. `public/event` says `waiver: true`; `<BookingWithWaiver>` shows attendee rows only then, otherwise a ticket
  and quantity (`plain=1`). The T065 e2e now covers the plain Free form.
- **Budget.** `public/booking` for a waiver booking awaiting signatures: 6 calls with Pro (5 + settings), within 8; the
  panel's Pro load/save count one more call (KV read of the cached catalogue, `waiverCalls` 2). `esign/catalog` is
  3 calls. Free Events backend: 105233 B (102.8 KiB) of 104 KiB.
- **Pro repo** (branch `pro-agent-t066`): `ad36d27` feat, `3ee6bee` test. Pro tests ran against this worktree's public
  source (the `node_modules` links were pointed at it); rebase both before merging.
- **Follow-ups.** The pay step after the last receipt still needs its Events seam (T065 follow-up 1, T073 covers the
  kept signed attendees). Reconciliation re-forwards a declined/expired receipt on every page load while the booking
  waits; harmless (idempotent) but one extra e-sign call per ref.
