---
id: T070
title: "Licence verification and Pro gating"
phase: 4
package: shared
edition: pro
status: done
model: opus-5.5
size: M
depends_on: [T011]
spec: [BUILD-PLAN §13, R17]
---

# T070 · Licence verification and Pro gating

## Definition

`licence.ts` verifies `semics1.` keys (Ed25519, hostname match, `updatesUntil` vs build date, local and preview hosts exempt) and a gating helper: no new paid work without a key, in-flight work continues.

## Model

**Opus 5.5**: Commercial security logic.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Valid key passes; wrong host, tampered or wrong product fails
- [x] Build after `updatesUntil` asks for renewal; older build keeps working
- [x] `localhost` and `*.workers.dev` exempt
- [x] Gate blocks new paid checkout but allows refunds

## Implementation (green, then refactor)

- `packages/shared/src/licence.ts`, `gate.ts`

## Acceptance criteria

- [x] Public key injected at build time
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```

## Notes

- **API.** `createLicenceVerifier({ publicKey, product, buildDate })` returns
  `({ key, hostname }) => Promise<Result<LicenceStatus, "LICENCE_INVALID" | "LICENCE_EXPIRED">>`.
  `LicenceStatus` is `{ kind: "licensed", hostname, licence }` or `{ kind: "exempt", hostname }`.
  `gateProWork(result, "new" | "in-flight")` / `gateProOperation(result, op)` turn that into allow/deny.
- **Build-time injection.** `emdash-plugin build` has no `define`, so the Pro build passes the raw
  base64url Ed25519 public key, its product and its release date as constants (a generated module in
  the private Pro repo) to `createLicenceVerifier`. The verifier never reads them from settings, so a
  site cannot substitute its own key pair (tested). A bad config throws at construction.
- **Key format.** `semics1.<b64url JSON>.<b64url sig>`; the signature covers the ASCII `semics1.<payload>`.
  Dates are `YYYY-MM-DD` UTC; `issuedAt <= updatesUntil`; `sites[]` holds 1-100 normalised hostnames
  (exact match, so `www.` is a separate site); unknown payload fields are tolerated for forward
  compatibility (they are signed). A `suite` key covers both products. Keys over 4096 chars are rejected
  before decoding; whitespace around a pasted key is trimmed.
- **Expiry.** Only the build date is compared with `updatesUntil` (perpetual fallback); wall-clock time
  is never consulted, so nothing breaks when a term ends. A newer build gets `LICENCE_EXPIRED`, which the
  admin UI should show as "renew for updates". The host is checked before the build date.
- **Exempt hosts.** `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`, `*.workers.dev`, `*.pages.dev`
  (the last as the Cloudflare preview host; the task names only the first and `*.workers.dev`). The bare
  `workers.dev`/`pages.dev` and look-alikes are not exempt.
- **Gate.** `PRO_OPERATIONS` is a default classification (checkout, promo create, reminder schedule,
  envelope send are new; refund, check-in, reports, waiver signing are in flight). Cores may gate any
  other operation with `gateProWork`. `src/gate.ts` was added to `strictBranches` alongside `licence.ts`.
- **No private key committed.** Every test key pair is generated at run time. `signLicence` exists for
  the future issuing tool (Paddle webhook) so both sides share one format.
- **Not done here (follow-ups).** Wiring into the cores (licence `secret` setting, calling the gate in
  the Pro checkout/send routes, a renewal banner) belongs to the Pro build tasks; nothing in
  `packages/events` or `packages/esign` was touched. Callers should cache the verifier result per
  invocation; one Ed25519 verify per request is cheap but not free.
