---
id: T153
title: "Intent `signBy`: E-sign refuses a signature once the booking's hold is over"
phase: 7
package: esign
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T152]
spec: []
---

# T153 · Intent `signBy` (void at expiry, not on next visit)

## Definition

T152 voids an ended booking's unsigned envelopes only when the buyer next opens the booking or waiver
page. Events can't call E-sign from the server (no allowed host, and sandboxed plugins can't call each
other), so the expiry sweep can't void anything. A signing token copied from the waiver cookie can
still sign until E-sign's own envelope expiry.

Proposal: let the signed intent carry the deadline, so E-sign enforces it with no call back to Events.

- New optional intent field `signBy` (integer Unix seconds, `signBy > iat`). It is covered by the
  signature. It is an unknown field to an older E-sign, which ignores it (§5 already says so), so the
  protocol stays `esign-intent/1`, the same way `resend` and `replace` were added (T133).
- E-sign sets the envelope's expiry to `min(its own setting, signBy + S)`. After that, `public/submit`
  refuses with the existing expired status, and the receipt says `"expired"`.
- Events (issuer rule) sets `signBy = booking.holdExpiresAt` on intents for seats the buyer signs
  inline while the hold runs. Emailed seats (`delivery: "email"`) of a confirmed booking get no
  `signBy`, or the event start, since they sign after the hold.
- When a hold is extended, Events re-issues the intent with the new `signBy`. Idempotency on
  `(cid, ref)` returns the same open envelope, and E-sign moves its expiry to the later deadline. A
  re-issue may only extend the deadline, never shorten it, so a replayed old intent can't cut it short.
- T152's on-visit voids stay as a second line of defence.

## Acceptance criteria

- [x] Protocol doc §5.1 gains `signBy` and the issuer rule; new vectors cover it and the
      shared vector tests pass.
- [x] A test fails today: a signature submitted after `signBy + S` is refused, and the receipt is
      `expired`.
- [x] Re-issuing with a later `signBy` extends an open envelope; an earlier one changes nothing.
- [x] Events (Free core or Pro, whichever mints intents) sets `signBy` for inline seats; bundle-size
      test passes (Events hotfix room is about 95 bytes, so prefer Pro).
- [x] An older E-sign given an intent with `signBy` still works (field ignored).

## Notes

Decisions

- **Vectors.** `signBy` follows `resend`/`replace`: verification never looks at it, and a bad value means absent
  (`signByOf` in E-sign), not `PAYLOAD_INVALID`. A rejection would have made every older E-sign fail the new vectors,
  against §11. The task asked for vectors and the T133 precedent had none, so the 4 new ones (106 in all, 57 intent)
  hold for old and new verifiers alike: `signBy` comes back whole, bad values still verify, a tampered one is
  `TOKEN_INVALID`. Cost: an issuer bug fails open to E-sign's own expiry, which is what an older E-sign does anyway.
- **Emailed seats: no `signBy`.** They are invited during `awaiting_signature` but sign after the hold, usually on a
  confirmed booking, when nothing can reach E-sign to move a deadline (T152). The event start was rejected: door signing
  happens at and after the start, and the step would need another read. Limitation left in place: an emailed seat of a
  booking that lapses stays open until T152's on-visit void or E-sign's `expiryDays`.
- **Who sets it (Pro, `waivers/intents.ts`, no Events backend change).** `issue` sets the hold on inline seats. Door link:
  `noHoldSignBy` (now + 366 days, past E-sign's 365-day maximum, so its own expiry applies). Sign now and corrections:
  the hold only in `awaiting_signature`, otherwise `noHoldSignBy`.
- **E-sign expiry on refusal.** The first refusal past the deadline also closes the envelope (`refuseExpired`, +3 calls),
  so the `expired` receipt exists at once rather than after up to an hour, and the next intent starts a fresh envelope.
  The response is unchanged (`SIGNING_TOKEN_EXPIRED`). This applies to every envelope, not just those with `signBy`.

What the code does (checked, not assumed)

- **The hold is extended in three places:** `checkout/continue`, reserve's retry (before intents exist) and
  `signatures/receipt`, which extends it after each receipt while seats remain. Continue re-issues; the receipt cannot, as
  Events cannot reach E-sign. With only the proposal's design, seat 2 of a multi-seat booking would have lapsed at the old
  hold while the booking still held. Fixed in the suite: `nextSigner` (`flow.ts`) continues and redeems after each receipt
  when seats remain, keeping the current token if that is refused. `lapsed` retries if E-sign still says expired while
  Events says the booking is open.
- **Paid bookings:** signing comes before payment. A booking reaches `awaiting_payment` only when every awaited inline
  seat is signed, so Stripe's later hold extension and the webhook have no inline envelope to lose. Hold time passing after
  payment affects only emailed seats (no `signBy`).
- **Leaving the hold with an unsigned inline seat** cannot happen through `signatures/receipt`, but can through: a seat
  corrected or signed by Sign now in `awaiting_payment`/`confirmed`; a downgrade to Free (continue ignores the waiver), then
  an upgrade. Handling: such seats get `noHoldSignBy`. E-sign reopens the unswept envelope, or starts a fresh one after a
  close; both tested in Pro's `integration.editions.test.ts`.
- **Where expiry lives:** `envelope.expiresAt` (ISO), set only by `sendEnvelope` for intents. `cron/intent-finish.ts` goes
  through it too, which is why the draft stores `signBy`. Enforced by `public/session`, `public/submit`, `public/decline`,
  Pro's `public/otp/send|verify` (shared check; refuses but does not close; the sweep does) and the hourly `expire` sweep.
  Several-signer submit passes the same check. No signing path skips it.
- **A re-issue past the deadline but not yet closed reopens the envelope.** Only a fresh HMAC-signed intent can do it, and
  Events refuses to mint for a lapsed hold.

Known gaps

- Deadline moves are not audit events: the extra 2 calls would take a resend re-issue past the limit of 10. `expiresAt` is
  not in the audit chain or the certificate.
- An email draft's `signBy` can race `intent-finish` (a stale value wins). Events never sets `signBy` on email intents, so
  only another integration could hit this.
- An inline re-issue with no later `signBy` for an envelope past E-sign's own expiry still gets a token that session
  refuses, until the refusal closes it. This predates T153; the refusal now closes it at once.
- No playground e2e (the playground cannot load Pro).

Evidence

- Red, then green: public `8c00375` failed 8 E-sign and 2 suite tests for the reasons above; Pro `8e8f675` failed 7.
- Public `pnpm verify` passes. Pro `pnpm verify` (`pro-agent-t153`) passes linked to the main checkout: 443 passed, 6
  skipped in Events Pro, 193 in E-sign Pro. The 6 are the T153 tests that need an enforcing E-sign; `describe.runIf` looks
  for `signBy` in the linked bundle, so they run by themselves once this branch is in the main checkout. That run is also
  the evidence for "an older E-sign ignores the field": every intent in it carries `signBy`, against an E-sign without it.
- Combined run: Pro's `node_modules` links were pointed at this worktree by hand (not committed, restored afterwards):
  Events Pro 449 of 449 and E-sign Pro 193 of 193. That Events Pro run predates two later Pro commits (formatting, a test
  type), which change no behaviour; it was not repeated. Pro's `verify` itself has not run against the combined code.
- Bundle: Events Free 123.79 kB, unchanged, no trims. E-sign Free 111.97 to 112.86 kB (budget 118.78 kB). E-sign Pro
  199.99 to 200.88 kB. Events Pro `plugin.mjs` 242,521 B (242,258 after T152).
- Not run: the playground e2e and a real browser through `/_events/waiver` (`nextSigner` is covered by the suite's
  faked-host tests only), and a real Stripe payment past the hold (the paid-booking finding comes from reading the code,
  and a fixture `awaiting_payment` Sign now test).
