---
id: T172
title: "One-click pairing of Events Pro with Vouchers Pro on the same site"
phase: 8
package: events-suite, vouchers-pro
edition: pro
status: review
model: opus-5.5
size: S
depends_on: []
spec: [T163]
---

# T172 · One-click Vouchers pairing

Reported from LMSC staging (2026-11-15): the client pasted Vouchers' pairing string into Events' `vouchersPairing`,
but the booking form still had no "Gift voucher code" box. Events Pro's `public/event` says `vouchers: true` only when
`voucherClient(settings)` parses that setting (`parseVoucherPairing`, which does not trim). Both plugins run on the
same site, so copy-paste is needless friction.

## Definition

1. Reuse T145's pattern (`lib/pair.ts`): the suite page, running as the signed-in admin, calls Vouchers' private
   `pairing/create` in process and writes the answered string into Events' `vouchersPairing` through the host's
   settings handler (`plugins:manage`). GET shows the state and a button; POST, with the same cross-site check, pairs.
2. Show the state: paired (Events' string parses and its client id is Vouchers' active `pairingClientId`), not paired,
   or stale (Events holds a client that is not the active one). When cheap and without exposing secrets, say why a
   pasted string was rejected.
3. Link to it from Vouchers admin's Pairing section and `/_vouchers/setup`.
4. Never print the pairing secret on the page or in logs.

## Acceptance criteria

- [x] Tests first in each repo: suite unit tests (`tests/vouchers-pair.test.ts`), the Pro admin test, and a Pro-build
      e2e (`apps/playground/e2e/t172-vouchers-pairing.spec.ts`).
- [x] Byte deltas reported (Free Events backend must not grow).
- [x] Changesets added (public suite, Pro vouchers-pro).

## Notes

- **Page:** a "Gift vouchers" section of `/_events/pair` (`#vouchers`), rendered only with `eventsSuite({ vouchers })`,
  rather than a new `/_vouchers/pair`. It reuses the page's settings handlers, cross-site check, admin gate and
  error texts; a second page would have copied all of them. The logic is `lib/vouchers-pair.ts` (`adminOf` is now
  exported from `pair.ts`). The h1 becomes "Pair Events with E-sign and Vouchers" when Vouchers is configured; the
  E-sign part (and its `pair-page` `data-state`) is unchanged.
- **State** (GET): the host's settings read of Events is the admin check; then two server-side reads with emdash's
  `getPluginSetting`: Events' `vouchersPairing` (decrypted; only its client id is kept) and Vouchers'
  `pairingClientId` (an id, not a secret). States: `paired`, `unpaired`, `stale` (another active client, or none:
  revoked), `rejected` with a reason: `spaces` (the string parses once trimmed: the likely LMSC cause), `esign` (an
  E-sign string), `malformed`. Client ids are shown (Vouchers' admin shows them too); the secret half never is.
- **Pair** (POST `action=vouchers-pair`): a no-op when already paired (no second client). Otherwise Vouchers'
  `pairing/create` as the admin with a fresh server-side `Request` (no browser headers), the answer checked against
  the `voucher1.` format, written with the host's settings write, PRG to `?vresult=…#vouchers`. "Plugin not
  enabled/found" from the host is `vouchers-missing` (only found on POST: the GET does not call Vouchers).
- **Old clients are not revoked** by the page: bookings held under an older client still settle with it. The docs
  keep the manual step (settle open holds under **Unsettled**, then revoke).
- **Vouchers admin (Pro):** a "Pair in one click (Events suite)" link (absolute, from `ctx.site.url`) next to the
  Pair button; the not-paired notice mentions it; the shown-once text says to paste exactly, with nothing around it.
- Follow-up, not done: Events Pro's `voucherClient` could trim the stored string (a few bytes in Events Pro), so a
  hand-pasted string with a trailing line break works. Left out because the one-click page writes it exactly and the
  page now explains the rejection.
- **Bytes:** Free Events `plugin.mjs` 119,392 B, unchanged (0 B: the change is Astro/site-side). Events Pro
  252,061 B, unchanged. Vouchers Pro `plugin.mjs` 71,201 → 71,564 B (+363 B: the admin link and copy).
- **e2e:** Pro build (`EMDASH_PRO_DIR` = the T172 Pro worktree): `t172-vouchers-pairing` 1/1 and `t168-vouchers`
  7/7 passed; `t145-auto-pairing` 2/3, the third being T150's Free-only assertion ("templates need Events Pro"),
  which fails on any Pro build. Free build: `t145-auto-pairing` 3/3 passed, `t172` skipped as designed.
