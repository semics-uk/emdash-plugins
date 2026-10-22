---
id: T119
title: "Integration: hardening from the Phase 3 review"
phase: 6
package: suite
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T067]
spec: [SX-FR-04, SX-FR-05, EV-FR-12, R5, R44]
---

# T119 · Integration: hardening from the Phase 3 review

## Definition

The Severity 3 and 4 findings of the Phase 3 gate review (`tasks/reviews/phase-3.md`) that no other task
owns. None is exploitable today. The Pro halves live in the Pro repo (`packages/events-pro/src/waivers/`),
the seams here, test-first as usual.

## Model

**Opus 5.5**: Protocol and cross-core behaviour, each path inside the 10-call budget.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] (F5) An adult who signed their emailed waiver without JavaScript (or closed the tab on the redirect) is still recorded: the door link reconciles a `completed` envelope (e.g. the Pro door link also carries a lookup request and `/_events/sign` forwards the receipt when from-intent answers `completed`), and/or `public/booking` lists the pending email refs of a confirmed waiver booking
- [x] (F6) After a switch from Pro to Free, continuing a booking still `awaiting_signature` keeps its stored attendees and receipts (today Free replans them in the buyer's name), and attendees left `pending` by a waiver can be checked in on Free (no door link and no receipt route exist there)
- [x] (F7) Once a booking is `awaiting_signature`, continue refuses to change an attendee's name, email or `minor` flag for a seat that already has an envelope (today a buyer can re-describe unsigned seats mid-flow; e-sign no longer hands such an intent a signing token, T067 F2)
- [x] (F8) The emailed-adult invitations a single order can make e-sign send are bounded (seats per order and the per-IP reserve limit today); decide and test a per-booking cap or document it as accepted
- [x] (F11) `safeReturnPath` (suite) and `safeReturnTo` (Events) never return a path starting with `//` (`/.//evil.example`, `/%2e//evil.example`); today the error-location helpers reparse it, which is what keeps it on the site
- [x] (F13) The waiver page's retry cookie (`semics_waiver_access_<ref>`) is cleared once signing proceeds

## Implementation (green, then refactor)

- `packages/events-suite/src/astro/lib/{flow,form}.ts`, `packages/events/src/astro/lib/{receipt,widget}.ts`,
  `packages/events/src/routes/{booking,checkout-continue,attendees}.ts`; Pro `src/waivers/door.ts`

## Acceptance criteria

- [x] Every test above passes; budgets asserted (≤ 10 bridge calls, target 8)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
```

## Notes

- **F5, both halves.** `public/booking` of a *confirmed* waiver booking lists its seats still `pending`
  (with Pro's lookups, reusing the settings read the confirmed answer already makes, so no extra call), so
  the buyer's next visit records an emailed adult who signed without JavaScript. The Pro door link is now
  `/_events/sign#intent=<intent>&lookup=<esign-lookup/1>`; the fragment client fills every token into the
  form, and when from-intent answers `completed` without a token the door page looks the receipt up and
  forwards it, then says "check the attendee in again". The lookup lives 5 minutes (the intent 15): a link
  opened later falls back to "may already be signed", and the booking-page path still covers it.
- **F6 (R44).** Free keeps a waiting booking's stored attendees (signed ones stay `valid` with their
  receipt, unsigned ones stay `pending`) and confirms it. The edition's waiver support is the admin
  `signingLink` seam: without it (Free) `checkIn(..., { waivers: false })` admits a `pending` attendee of a
  confirmed waiver booking, and `public/booking` (no `lookups` step) shows their pass code. Nothing is
  rewritten to `valid`, so an upgrade back to Pro still asks them to sign.
- **F7.** Decided: once a waiver booking's intents are out (`awaiting_signature`, or a waiver booking
  `awaiting_payment`), continue writes back the stored attendees and refuses any `attendees` that differ in
  ticket type, name, email or under-18 for any seat (`ATTENDEES_LOCKED`); the same attendees again (a
  resubmitted form) are accepted. Every seat had an intent at the first sign step, so "a seat with an
  envelope" is every seat. To change attendees the buyer cancels and books again. This also fixes a
  latent bug found on the way: `payOrLand` continues an `awaiting_payment` waiver booking without
  attendees, which replanned an emailed adult who had not signed yet in the buyer's name. The stored read
  replaces `keepSigned`'s, so the paths keep their counts (sign 6, pay 6, Free confirm ≤ 10 with the
  counter room reduced by one).
- **F8: R48** (new BUILD-PLAN §12 row, protocol §5.1 issuer rule): email intents only to the address the
  buyer entered for the seat, at most 10 emailed adults per booking (Pro `MAX_EMAIL_SIGNERS`,
  `WAIVER_TOO_MANY_EMAILS` at continue before anything is held at e-sign; the suite shows its own message),
  seats locked once intents are out (F7), and the existing per-IP reserve limit as the rate limit (at most
  100 invitations per connection per 10 minutes). No per-recipient limit at e-sign (would cost a counter
  write on `from-intent`).
- **F13.** The retry cookie is now cleared on every exit from the waiver page (last signer, a decline,
  continue answering `done`/`pay`/only email signers) and kept only while this page still has a ceremony
  or the post-signing payment step (`payOrLand` needs it).
- **Pro budget constant.** Free Events is now 104.2 KiB (≤ 112, R47; E-sign 103.9 unchanged). The Pro
  repo's pro-kit still asserted the old 104 KiB Free budget; updated to R47's 112 KiB (Pro commit).
  Pro Events backend 165.3 KiB (≤ 256).
- **Proof.** Pro `tests/integration.editions.test.ts` (both real bundles, every call ≤ 10 bridge calls):
  emailed adult without JS recorded via the booking page and via the door link, then checked in; seats
  cannot be re-described (e-sign keeps 3 envelopes); 11 emailed adults refused, nothing at e-sign; a Pro
  hold open at the downgrade keeps attendees, receipts and codes on Free, which shows every pass and checks
  the pending adult in. Playground e2e `waiver.spec.ts` and `t065-booking-with-waiver.spec.ts` green (run
  on a temporary port 4419 config, deleted; 4401 was taken). The Pro worktree's `node_modules` links point
  at this worktree for the run (not committed, F17).
