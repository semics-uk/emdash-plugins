# Security review of both products (T100)

Adversarial review of Events and E-sign in both editions (the Free cores and UI halves in this repo, the Pro
builds and the licence Worker in the private Pro repo), 2026-10-22, at public main after T102 and Pro main after
T086. Every open criterion filed on T100 by earlier reviews (T034, T057, T081, T086, T093, T094, T117) is answered
below. Severity: **1** exploitable now (data or token leak, oversell, money) · **2** breaks a stated security or
privacy contract with a realistic path · **3** defence-in-depth or robustness gap, low likelihood · **4** hygiene,
documentation, accepted risk.

Every finding is fixed test first (`test(T100)` then `fix(T100)`) or recorded as accepted with a test that pins
the accepted behaviour. Decisions are BUILD-PLAN R60–R63.

## Summary

| Severity | Found | Fixed | Accepted (tested) |
| --- | --- | --- | --- |
| 1 | 0 | – | – |
| 2 | 1 | 1 | – |
| 3 | 7 | 6 | 1 |
| 4 | 12 | 4 | 8 |

No open Severity 1 or 2 findings. `pnpm audit` is justified below (no advisory reaches a shipped package).

## Findings

| # | Sev | Where | Finding | Status | Test |
| --- | --- | --- | --- | --- | --- |
| 1 | 2 | Events Pro reports | Full attendee exports (`report_exports`: names, emails, answers) were stored and never deleted, so they outlived the retention period and deletion on request | Fixed: indexed `expiresAt` 24 h after the last step; no download after it; swept in the rollup's first idle tick of each gap (≤ 4 calls); a new export deletes the old parts (R63) | Pro `reports-export.unit.test.ts`, `reports-job.unit.test.ts` (T100 blocks) |
| 2 | 3 | Shared rate limiter, both cores | KV has no TTL, so every `rl:<scope>:<ip hash>:<window>` key stayed for good; E-sign's and the promo check's salts are public constants, so the keys were a reversible log of visitor IPs (T081 criterion) | Fixed: values carry the window end, `sweepRateLimits` deletes ended keys, both retention passes start with it (R61) | `shared/tests/ratelimit.test.ts`, `events/tests/cron/retention.test.ts`, `esign/tests/retention.test.ts` (T100) |
| 3 | 3 | Events reserve, waitlist join | Without a Turnstile secret the booking `ipHash` and the waitlist limiter were salted with the public plugin id (T057 F6) | Fixed: a random undeclared `ipSalt` setting, stored by the first public write in the Turnstile call's place (reserve's worst case stays 10) (R61) | `events/tests/checkout-reserve.test.ts`, `tests/routes/waitlist.test.ts` (T100) |
| 4 | 3 | E-sign Pro OTP verify | The wrong-guess counter was a read-modify-write guarded on status only: 12 guesses sent at once got 12 compares on one code | Fixed: an atomic claim (`otpTries`, `lt 5`, `inc 1`) before any answer (R63) | Pro `otp.editions.test.ts` "guesses sent at once" |
| 5 | 3 | E-sign Pro PDF reader | No cap on inflation: a 3 MiB deflate bomb in an xref or object stream inflates to gigabytes in the upload, send and render invocations; an absurd `/Columns` allocated its row (T094 follow-up) | Fixed: 16 MiB in all per file (`PDF_UNSUPPORTED`), rows ≤ 1024 bytes (R63) | Pro `pdf-fuzz.unit.test.ts`: 480 seeded mutants of four T094 fixtures plus bomb, predictor, `/Prev` loop, 100 000-deep nesting, 10⁹ xref count |
| 6 | 3 | Licence Worker | `transaction.completed` for a licence's first transaction under a new event id (a resend or a replay) took the first-payment path: a refunded or cancelled licence was re-issued, set active and given a registry token | Fixed: a closed licence answers `refused` | Pro `licence-worker/tests/webhook.worker.test.ts` (T100, refund and cancellation) |
| 7 | 3 | E-sign Pro `public/self-serve/start` | Ran at exactly 10 calls, so an error-path log would be the 11th (T093) | Fixed: the licence is checked from the settings list the route reads anyway: 9 calls; daily caps moved to `rl:ss-cap:<template>:<day>` so retention sweeps them (R61) | Pro `self-serve.editions.test.ts` (≤ 9), `self-serve.unit.test.ts` |
| 8 | 3 | Sandboxed routes (EmDash dispatch) | A thrown error reaches public callers as `400 ROUTE_ERROR` with the raw message (T034 F10) | Accepted: every message the cores and shared build is a fixed string or interpolates an allowlisted constant, kind, zone or placeholder name; none carries stored data or a token. Host errors (storage, decryption) carry no values (R62) | `scripts/security.test.mjs` |
| 9 | 4 | Shared outbox | `lastError` kept 300 characters of the provider's error, which could echo a booking link with its one-time code (T057 F12) | Fixed: URLs and token-like runs are replaced before storing | `shared/tests/outbox.test.ts` (T100) |
| 10 | 4 | Events CSV | Formula defence missed full-width `＝ ＋ － ＠` (T057 F13); Pro's exports reuse `csvCell` | Fixed | `events/tests/admin/csv.test.ts` (T100) |
| 11 | 4 | Events `checkout/continue` | An unknown ref returned before hashing, unlike booking, cancel and redeem (T057 F10) | Fixed: `verifyToken` takes a missing hash and compares a decoy; continue, booking and redeem all use it | `events/tests/routes/checkout-continue.test.ts`, `shared/tests/tokens.test.ts` (T100) |
| 12 | 4 | Events core | The scaffold `hello` route was still declared (T057 F14, also on T106) | Fixed (removed; its bytes paid for the fixes above) | `events/tests/plugin.test.ts` |
| 13 | 4 | E-sign `from-intent` | No rate limit (T034 F20) | Accepted: a malformed token costs 0 calls, an unknown `cid` 2 reads and no write; a counter would cost 2 calls on a route at 9 (R62) | `esign/tests/from-intent.routes.test.ts` (T100) |
| 14 | 4 | Events booking, cancel, redeem, continue, waitlist claim | No per-IP limit on wrong tokens or codes (T057 F11) | Accepted: tokens and codes are 256-bit `generateToken` values; unknown ref and wrong token cost the same (finding 11) (R62) | `shared/tests/tokens.test.ts`, `events/tests/routes/booking.test.ts` |
| 15 | 4 | Events reserve | A resubmit with the same idempotency key, buyer email and lines re-issues a held booking's token (T057 F16) | Accepted: the key is 256-bit, made in the browser with JS; without JS it sits in the server-rendered form, so a page cache shared between visitors would share it, and an attacker would still need the victim's email and exact order within the hold; a confirmed booking keeps its emailed token (R62). Sites caching event pages publicly should know this (operator guide, T103) | `events/tests/checkout-reserve.test.ts` (resubmit tests) |
| 16 | 4 | E-sign core | The core imports `src/astro/lib/markdown.ts` for the signed PDF (T117 exception) | Confirmed: it imports nothing; pinned | `scripts/security.test.mjs` |
| 17 | 4 | Events Pro MCP | Per-call token hash minted so Free booking routes run as admin (T086 follow-up) | Confirmed: only the proxied query result carries it; it is never written, logged or returned; the buyer's own token keeps working; every `pro/mcp/*` route refuses a user without `plugins:manage` (existing test) | Pro `mcp.editions.test.ts` (T100 block, and "refuse a user without plugins:manage") |
| 18 | 4 | Events Pro MCP | Paid cancel and refund above the 8-call target (T086 follow-up) | Accepted as R60: measured 10 and 9, the same paths as `public/booking/cancel` and the bookings page; no log on either path | Pro `mcp.editions.test.ts` "R22 exception (R60)" |
| 19 | 4 | E-sign Pro OTP send, all limiters | The per-signer send throttle and the shared `rateLimit` are read-then-write, so bursts can pass them | Accepted: the throttle needs the 256-bit signing token and only mails the signer's own address; limiters are abuse controls (documented in `ratelimit.ts`); the code's attempts are now atomic (finding 4) | – |
| 20 | 4 | E-sign Pro PDF active-content check | The denylist (R53) does not name `/GoToR`, `/GoToE` or embedded files | Accepted: uploads come only from an admin, the original bytes are what is signed, and refusing embedded files would refuse PDF/A-3 invoices; no script runs in the site origin (CSP `sandbox` on raw responses) | – |

## Threat model by public route

Checked on every public route of both cores and of the Pro builds: authentication, CSRF, rate limits and bot
checks, token handling, IDOR, injection into emails/CSV/PDF/ICS, SSRF, redirects, webhook signatures, timing,
secrets in logs, personal-data retention.

| Route(s) | Auth / abuse control | Notes |
| --- | --- | --- |
| Events `public/events`, `public/event`, `public/event/ics` | Public data only | Draft, unpublished and orphaned events are `NOT_FOUND`; answers carry seats left, never counters (T046). ICS text is escaped by shared `ics.ts`; JSON-LD replaces `<` |
| Events `checkout/reserve`, `waitlist/join` | Turnstile when a secret is set; per-IP limits on salted hashes (findings 3, 2) | Bodies validated with the built-in validator (unknown keys refused); token returned once, hash stored |
| Events `checkout/continue`, `booking`, `booking/cancel`, `booking/redeem`, `waitlist/claim`, `booking/ics` | 256-bit token or one-time code in the POST body; signed 15-minute link for ICS | Unknown ref = wrong token (finding 11); tokens refused on GET (`TOKEN_IN_QUERY`); redeem single-use, guarded write; R34 no GET side effect |
| Events `webhooks/stripe` (Free) | Answers 503, reads nothing | Pro: `Stripe-Signature` HMAC over the raw body, every `v1` compared in constant time, 5-minute tolerance, wrong amounts refunded (R49) |
| Events `signatures/receipt` | Pro: protocol HMAC (shared verifier, pairing secret) | Free stub `NOT_FOUND` |
| Events Pro `public/promo/check` | Licence gate, 30 checks / 10 min per IP | Salt is the plugin id (keys now swept, finding 2) |
| Events Pro `public/mail/opt-out` | HMAC over ref and recipient keyed by the booking's `accessTokenHash`, constant-time | POST only, from the Free page (R57) |
| Events Pro `checkin/code`, `pro/mcp/*` (private) | EmDash admin session, `plugins:manage`; `X-EmDash-Request` CSRF header | Finding 17 |
| E-sign `envelopes/from-intent`, `receipts/lookup`, `templates/catalog` | `esign-intent/1` HMAC per client, nonces, return-URL allowlist | Finding 13; lookup and catalog are read-only and HMAC-authenticated |
| E-sign `session`, `submit`, `decline` | 256-bit signing token in the POST body; per-IP wrong-token counter (R29) | Submit only from `in_progress` (R31); consent hash; Free refuses envelopes it cannot complete (several signers, PDF, OTP) |
| E-sign `download` | 15-minute signed link (or 1-hour `d` link for a PDF template while signable) | Raw response, stored bytes re-hashed; EmDash serves raw plugin responses with `CSP: sandbox` and `nosniff` |
| E-sign `verify` | Per-IP limit; only a SHA-256 is sent | Purged records answer `matched: false` (R45) |
| E-sign `otp/send`, `otp/verify` | Pro: signing token, per-IP limits, per-signer throttle, 5 atomic attempts (finding 4) | Code only emailed, stored as a salted hash |
| E-sign `self-serve/start` | Pro: Turnstile mandatory, honeypot, per-IP limit, daily cap, answers only `check_email` (R50) | Finding 7 |
| Licence Worker `POST /paddle/webhook` | `Paddle-Signature` HMAC (constant time, 5-minute tolerance), event ids processed once, body ≤ 256 KiB | Finding 6; parameterised D1 statements; registry tokens stored as SHA-256; nothing secret logged |
| UI posts (`/_events/checkout`, `/_events/promo`, `/_events/waitlist`, booking page, `/sign/[token]`, `/verify`, `/_esign/start`, opt-out, door sign) | `isCrossSiteRequest` first (EmDash turns Astro's origin check off) | Return paths through `safeReturnTo` (same origin, no `//`, `/.//`, `\\`, plugin paths; T119 F11); pay URLs followed only when `https:`; no `set:html` (tested) |

Other checks with no finding: no core or Pro route echoes an exception's message except the fixed codes; the only
log calls carry ids and counts (host redaction covers declared secrets); no outbound request goes to a host a
visitor chooses (Turnstile, Stripe and Paddle hosts are fixed; return and pay URLs are browser redirects only);
email bodies are built with a plain `fill` (R32) and subjects from admin titles; the Pro reports export route is a
private GET serving `text/csv` as an attachment.

## Dependency audit

`pnpm audit` (2026-10-22): public repo 3 low, 12 moderate, 5 high; Pro repo 3 moderate; no critical. None reaches a
shipped package: the Free packages have no runtime `dependencies` (EmDash is a peer) and the Pro builds bundle only
their own and the Free sources.

- `undici` < 7.29.1 and `sharp` < 0.35.5 (all high and most moderate): only through
  `apps/playground > @emdash-cms/sandbox-workerd > miniflare`, the local demo site.
- `@vitest/mocker` < 4.1.12 (moderate): the test runner, dev only.
- `sanitize-html` 2.18.0 (moderate, unbounded recursion on re-sanitizing): inside `emdash` 1.2.0, the host the
  site owner installs, not our code.

Justified as dev-only or host-side. No owner action is needed now; bump `vitest` to ≥ 4.1.12 at the next toolchain
update, and the playground's EmDash/miniflare when EmDash ships a release with the patched versions.

## Sizes after T100

| Backend | Before | After | Budget |
| --- | --- | --- | --- |
| Free Events | 115.9 KiB | 115.97 KiB (118 756 B) | 116 KiB (R51) |
| Free E-sign | 105.0 KiB | 105.3 KiB | 116 KiB |
| Events Pro | 206.5 KiB | 207.2 KiB | 256 KiB (R43) |
| E-sign Pro | 190.1 KiB | 191.3 KiB | 256 KiB |

The Free Events fixes cost about 250 B, paid for by removing the scaffold `hello` route and shortening internal
error strings (separate `refactor(T100)` commits), so no budget change was needed.

## Owner actions

None required. Recommended at the next toolchain update: `vitest` ≥ 4.1.12 (dev). Report upstream to EmDash when
convenient: `sanitize-html` 2.18.0 in `emdash` 1.2.0.
