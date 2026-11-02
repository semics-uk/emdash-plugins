---
id: T152
title: "Void a booking's E-sign envelopes when its hold expires"
phase: 7
package: events
edition: pro
status: backlog
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

- [ ] A test fails today: after a waiver booking's hold expires, its envelopes are voided and E-sign
      refuses a signature on them.
- [ ] The void is retried safely (idempotent) and never blocks the expiry itself.
- [ ] Bundle-size test passes (Events hotfix room is ~95 bytes after T151); trims named.
