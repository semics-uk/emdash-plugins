---
id: T149
title: "Pair page: a hand-made pairing shows as revoked; pairing again leaves two clients"
phase: 7
package: events-suite
edition: free
status: done
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

- [x] A test fails today: a hand-made, active pairing shows as paired (not revoked) on `/_events/pair`.
- [x] Pairing from a hand-made state leaves exactly one active client used by Events, or the page
      names the leftover client to revoke; the secret is still never shown, logged or sent to the browser.
- [x] Revoked and none states still behave as T145 (its e2e passes).

## Notes

- Chosen path: adopt (preferred). The suite reads Events' stored pairing server side with emdash's public
  `getPluginSetting(eventsPluginId, "esignPairing")` (it decrypts; called only after the host's settings
  read has passed the admin check), keeps only the client id (`esign1.<id>.…`) and sends it as `clientId`
  to E-sign's `integrations/pair`. The secret half is dropped in `lib/pair.ts` and is never sent to E-sign,
  the browser, a URL or a log (asserted in the suite test and the e2e).
- E-sign: with `clientId`, `status` reports that client (a hand-made active one is `active`, an unknown id
  `none`); `pair` reuses it while active and adopts it as the site client (KV), revoking the auto-pair client
  it replaces, so exactly one active client serves Events; a revoked one falls back to the site client or a
  new one; `unpair` revokes it and the site client. Malformed ids are `BAD_REQUEST`. Budget: adopt 6 calls.
- An in-process admin caller naming any client id gets that client's derived pairing back from `pair`.
  The route is still admin-only and refuses browser headers, and the suite only ever passes the id Events
  already holds the secret for, so nothing new reaches a browser.
- Tests: `packages/esign/tests/pair.routes.test.ts` (T149 x5), `packages/events-suite/tests/pair.test.ts`
  (T149 x3), e2e `apps/playground/e2e/t145-auto-pairing.spec.ts` "T149 …" (reproduced "revoked" first).
