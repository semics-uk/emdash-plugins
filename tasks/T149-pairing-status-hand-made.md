---
id: T149
title: "Pair page: a hand-made pairing shows as revoked; pairing again leaves two clients"
phase: 7
package: events-suite
edition: free
status: backlog
model: opus-5.5
size: S
depends_on: [T145]
spec: []
---

# T149 · Hand-made pairings on the pair page

## Definition

From LMSC staging after T145. A site paired by hand (E-sign client "Events", active) opens
`/_events/pair` and sees "E-sign revoked this pairing. Pair again…". E-sign's `integrations/pair`
`status` only knows the client id auto-pair stored in KV (`integrations:site-client`); with none it
returns `client: "none"`, and the suite's `pairingStatus` reads "Events has a pairing + client not
active" as revoked. Clicking Pair then creates "Events on this site" and replaces the stored string,
leaving the hand-made client active but unused.

The pairing string is `esign1.<clientId>.<secret>`; the host's settings handler won't return the
secret, so find what the suite can learn in process (the client id alone is enough to identify the
hand-made client, if any path exposes it without the secret). Pick the best of:
adopt the hand-made client as the site client (preferred, if its id is obtainable without
exposing the secret); otherwise report a distinct "paired by hand" state, and when the admin pairs
from it, revoke the replaced client in the same step (or say plainly which client on the
Integrations page is now unused).

## Acceptance criteria

- [ ] A test fails today: a hand-made, active pairing shows as paired (not revoked) on `/_events/pair`.
- [ ] Pairing from a hand-made state leaves exactly one active client used by Events, or the page
      names the leftover client to revoke; the secret is still never shown, logged or sent to the browser.
- [ ] Revoked and none states still behave as T145 (its e2e passes).
