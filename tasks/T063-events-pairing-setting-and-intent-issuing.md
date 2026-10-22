---
id: T063
title: "Events: pairing setting and intent issuing"
phase: 3
package: events
edition: pro
status: done
model: opus-5.5
size: M
depends_on: [T057, T012, T071]
spec: [EV-FR-12, R5]
---

# T063 · Events: pairing setting and intent issuing

## Definition

`esignPairing` secret setting; issue intents for the buyer (self and minors) inline and for other adult attendees by email; cap intent expiry at the remaining hold.

## Model

**Opus 5.5**: Rules spanning booking state and protocol.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Buyer and minors get inline intents; other adults get email intents
- [x] Intent expiry ≤ remaining hold
- [x] Without pairing, the waiver toggle is disabled with a banner

## Implementation (green, then refactor)

- `src/domain/waivers.ts`

## Acceptance criteria

- [x] Pro-gated (licence stub until T070)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **Where the code is (R40/R41).** Public (MIT) adds only seams, test-first: `src/seams.ts` exports
  `checkoutContinueRoute({ payment, signature })` and `editorTicketsRoute({ waivers })`; reserve copies a
  required waiver onto the booking as `waiver: { templateId, mode }`; attendee input accepts `minor: true`
  (stored on the attendee); continue hands a `waiver` booking to the optional `SignatureStep` (Free: none, the
  waiver is ignored, so a downgraded site keeps selling); the panel shows the waiver toggle only when the
  `waivers` check says it is available, else a banner (Free: always). The intent rules, signing, licence and
  pairing checks live in the Pro repo (`packages/events-pro/src/waivers/`, branch `pro-agent-t063`). **The
  public seam must land before the Pro branch** (Pro links the public main checkout).
- **Gating.** Not `licence.gate(op, route)` around the whole route: that would refuse every continue (free
  bookings too) without a licence. The step gates the waiver checkout itself with the same
  `gateProWork(…, PRO_OPERATIONS["events/checkout"])` (`LICENCE_INVALID`/`LICENCE_EXPIRED` before any
  write); no pairing is `PAIRING_MALFORMED`. The licence key and pairing are read from the `settings.list`
  continue already makes, so the gate costs no extra bridge call.
- **Budget.** Sign path: query, `settings.list`, `extendHold` → `awaiting_signature`, attendees, `hold-<ref>`
  re-arm = 5 calls (asserted ≤ 8 in both repos). Free confirm path unchanged (5–9). Pro panel load 4, save ≤ 8
  (`saveConfig` takes `reservedCalls` for the panel's settings read).
- **Intents.** `ref = <bookingRef>:<seat>` (seat of the attendee document id `<bookingId>-<seat>`), not the
  check-in code, which is a credential (R33). Buyer's own seat (buyer's name and email) inline `self`; minors
  inline `guardian` with `participant`; other adults `email`/`self` signed by that attendee. An adult seat
  with only the buyer's email is refused `BAD_REQUEST` / `WAIVER_EMAIL_REQUIRED`. Mode `buyer`: one inline
  intent `ref = <bookingRef>`. `exp = min(iat + 1800, holdExpiresAt)`; `returnUrl = <site>/booking?ref=`;
  `prefill: {}`. Tokens only in the response body (`next.intents[].token`).
- **Bundle size.** The Pro events core hit 129.1 KiB with shared `signEsignToken` (its validator for all
  four token types, ~2 KB) against the 128 KiB per-file bundle limit, so Pro signs with the §4 HMAC directly
  (shared `ESIGN_PREFIXES`, `encodeBase64Url`); every minted token is verified with `verifyIntentToken` in
  the tests. It is now 127.0 KiB: **about 1 KiB of headroom**, so T064/T073+ will not fit in this core
  without a decision (slim the Free core, or drop the registry per-file check for the private-npm Pro build).
- **Follow-ups.** The suite (T065) calls `from-intent` for every intent, inline and email; an email intent
  answered `status: "draft"` is "invitation on its way" (T062/T113), like `sent`. Re-entering continue while
  `awaiting_signature` re-issues fresh intents (idempotent at e-sign on `(cid, ref)`); T064 moves the booking
  on when receipts arrive. `config/save` (admin API) can still set `signature.required` without a licence;
  checkout then refuses in Pro and ignores it in Free. The booking widget has no "under 18" checkbox yet (T065).
  Attendee names are not checked for C0 control characters, which e-sign would refuse as `PAYLOAD_INVALID`.
