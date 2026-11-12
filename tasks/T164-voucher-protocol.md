---
id: T164
title: "Protocol voucher/1: doc, test vectors and shared token code"
phase: 8
package: shared
edition: free
status: in-progress
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

- [ ] Doc, vectors and helpers; 100% branch coverage on the token and code modules.
- [ ] No change to any plugin bundle; `pnpm verify` green.
