---
id: T152
title: "Void a booking's E-sign envelopes when its hold expires"
phase: 7
package: events
edition: pro
status: review
model: opus-5.5
size: S
depends_on: [T151]
spec: []
---

# T152 · Void envelopes on hold expiry

## Definition

Found in T151. The waiver page refuses an expired booking and Events' `signatures/receipt` confirms
nothing for it, but someone who copies the signing token from the HttpOnly cookie could still sign the
envelope directly with E-sign; Events ignores the signature, yet E-sign records a signed document for
a booking that no longer exists. When a hold expires (or a booking is cancelled before signing), void
its open envelopes through the existing integration (`from-intent` has `replace`/void since T133).

## Acceptance criteria

- [x] A test fails today: after a waiver booking's hold expires, its envelopes are voided and E-sign
      refuses a signature on them.
- [x] The void is retried safely (idempotent) and never blocks the expiry itself.
- [x] Bundle-size test passes (Events hotfix room is ~95 bytes after T151); trims named.

## Notes

- Neither core can reach the other server side: Events has no host for e-sign (allowedHosts are frozen
  and the site host is unknown at build), and EmDash gives sandboxed plugins no cross-plugin calls. So the
  sweep cannot void anything itself. Decided: Pro mints the voids, the pages that read the booking in
  process redeem them (the same shape as T066's lookups).
- Pro (`emdash-plugins-pro`, branch `t152-void-envelopes`): `src/waivers/voids.ts`, wired in `withSigningList`
  (`public/booking`). For a waiver booking that has ended (`expired`, `cancelled`, `declined`, `refunded`,
  `refunded_unavailable`, or a hold status past `holdExpiresAt`), the answer carries `waiver: { refs: [], voids }`:
  one `replace` intent per seat not signed (seats with a terminal receipt and no reissue are skipped; at most 10;
  mode `buyer`: the booking's own ref). The signer is the buyer's address under the name `Booking ended (void)`,
  as `self`, so e-sign's same-signer check never keeps an envelope open. Intent `exp` is 15 minutes. +1 call
  (settings) only when there is something to void: 4 calls in all. Nothing is stored.
- Public repo: `reconcileWanted` (Events `lib/widget.ts`) makes `/booking` call the suite's reconcile for
  `voids` too; `voidEnvelopes` (suite `lib/reconcile.ts`) posts each to E-sign `public/envelopes/from-intent`,
  swallowing failures; the waiver page's `BOOKING_EXPIRED` path runs it too.
- Idempotent: e-sign leaves a voided or completed envelope alone (`none` / the envelope), so each visit may
  send them again; the expiry (sweep) is untouched and never waits for e-sign.
- Limitation: the void happens on the buyer's next visit to `/booking` or `/_events/waiver`, not at the moment
  of expiry. Someone who lifted a token and never revisits can still sign until e-sign's own `expiryDays`.
  Closing that fully needs a protocol change (e.g. an envelope deadline carried by the intent) or a
  server-to-server channel: a follow-up task if wanted.
- Bundle: the Events Free backend is unchanged (123,792 B, no trims needed); all logic is Pro (Pro
  `plugin.mjs` 241,143 -> 242,258 B). Events and suite change only native UI code.
- Tests: Pro `tests/integration.editions.test.ts` "T152" (expiry via the sweep, cancel, still-waiting; real
  bundles, budgets asserted); suite `reconcile.test.ts`, `flow.test.ts`; Events `tests/ui/widget.test.ts`.
  No playground e2e was run (the playground cannot load Pro).
