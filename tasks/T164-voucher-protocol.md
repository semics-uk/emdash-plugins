---
id: T164
title: "Protocol voucher/1: doc, test vectors and shared token code"
phase: 8
package: shared
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T163]
spec: [R16]
---

# T164 · Protocol `voucher/1`

## Definition

Write `docs/protocol/voucher-v1.md` and implement it in `packages/shared`, as specified in T163 §8. Reuse the
`esign-intent/1` primitives: base64url, the pairing string, HMAC-SHA-256 with a prefix per token type, and the
verification algorithm. Add no new crypto.

- Tokens: `voucher-hold/1` (signed by Vouchers), `voucher-settle/1` (signed by Events), `voucher-lookup/1`.
- Payload schemas. Bounds on every field.
- Error codes in the shared registry: `VOUCHER_INVALID`, `VOUCHER_NO_BALANCE`, `VOUCHER_WRONG_ACTIVITY`,
  `VOUCHER_CURRENCY`, `VOUCHER_UNAVAILABLE`.
- Voucher code helpers: generation (80 bits, injected randomness), Crockford normalisation (any case,
  O→0, I/L→1), grouping, and the SHA-256 id.

## Tests first

- Vectors (`docs/protocol/voucher-vectors.json`, generator, `node --test`): valid, expired, wrong prefix,
  tampered, wrong client, malformed base64url.
- Unit: schema bounds, code normalisation round trip, uniform code alphabet, and the id is stable across
  case and confusable characters.

## Acceptance criteria

- [x] Doc, vectors and helpers; 100% branch coverage on the token and code modules.
- [x] No change to any plugin bundle; `pnpm verify` green.

## Notes

- **Files.** `docs/protocol/voucher-v1.md`, `generate-voucher-vectors.mjs`, `voucher-vectors.json` (135 vectors:
  49 hold, 33 settle, 26 lookup, 9 pairing, 18 code), `voucher-vectors.test.mjs` (picked up by `test:scripts`);
  `packages/shared/src/voucher.ts` and `voucher-code.ts`, both at 100% lines and branches (`strictBranches`).
- **Decisions the spec left open** (recorded in the doc):
  - The pairing string is `voucher1.<clientId>.<secret>`, so an `esign1.` pairing pasted into the vouchers field
    is refused.
  - Field names: hold `{rid, iat, exp, ref, kind, amountMinor, currency, line?}`, with `line` present iff
    `kind = "activity"`; settle `{rid, ref, outcome, creditMinor, at}`, where `creditMinor` is the total credited
    so far (so replays are idempotent); lookup `{ts, ref, rid}`.
  - The lookup carries `rid` as well as the booking ref (T163 §8 lists only the ref), so Events can sign
    `released` for a hold the booking no longer carries.
  - Amounts are bounded at 10,000,000 minor units. The hold lifetime is capped at 1800 s, and lookups at
    300 s plus 60 s of skew, as in esign-intent/1. Settle tokens never expire, like receipts.
  - Safety rule: Vouchers must not apply `released` before the hold's `exp + 60`. Until then Events could still
    accept the hold token.
  - Statuses: `VOUCHER_INVALID` 400, `NO_BALANCE`/`WRONG_ACTIVITY`/`CURRENCY` 409, `UNAVAILABLE` 503.
- **Error registry.** The `VOUCHER_*` codes are in a new `VOUCHERS_ERROR_CODES` table (common, protocol,
  payments, licence and voucher groups), not in `ERROR_CODES`. E-sign maps errors through the whole
  `ERROR_CODES`, so adding the codes there would have grown its bundle. `ErrorCode` is unchanged and
  `VoucherErrorCode` is new. Use `routeErrorFrom(VOUCHERS_ERROR_CODES, …)`; `toRouteError` would answer
  `INTERNAL`. T166: Events Pro should pass `{ ...ERROR_CODES, ...VOUCHERS_ERROR_CODES }` to `useErrorCodes`.
- **Reuse versus bundles.** `hmac.ts` now also exports its private helpers under clear names (`tokenSignature`,
  `decodeJsonObject`, `isJsonObject`, `isUnixTime`, `matchesPattern`, `ID64_PATTERN`, `REF_PATTERN`). The voucher
  verifier's steps 1–5 are a second copy of `authenticate`, about 15 lines. Making `authenticate` generic would
  have changed the e-sign and Events bundles. The Events `plugin.mjs` (119,392 B) and e-sign `plugin.mjs`
  (112,904 B) are byte-identical before and after (`cmp`). Follow-up for T166, where Events Pro bundles both
  modules: fold the two copies into one generic `authenticate` if a few bytes of change in e-sign are acceptable
  then.
- **No changeset.** Only the private `@semics-tech/shared` changed, and no core imports the new code yet.
