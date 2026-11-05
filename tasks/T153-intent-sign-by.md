---
id: T153
title: "Intent `signBy`: E-sign refuses a signature once the booking's hold is over"
phase: 7
package: esign
edition: free
status: in-progress
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

- [ ] Protocol doc §5.1 gains `signBy` and the issuer rule; new vectors cover it and the
      shared vector tests pass.
- [ ] A test fails today: a signature submitted after `signBy + S` is refused, and the receipt is
      `expired`.
- [ ] Re-issuing with a later `signBy` extends an open envelope; an earlier one changes nothing.
- [ ] Events (Free core or Pro, whichever mints intents) sets `signBy` for inline seats; bundle-size
      test passes (Events hotfix room is about 95 bytes, so prefer Pro).
- [ ] An older E-sign given an intent with `signBy` still works (field ignored).
