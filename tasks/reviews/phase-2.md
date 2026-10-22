# Phase 2 gate review: Events core and UI (T057)

Adversarial review of T040–T056 and T116 (the Events core, its public routes, crons and admin, and the
native UI), 2026-10-22. Reviewed at `fc1667d` (main). Severity: **1** exploitable now (data or token leak,
oversell, money) · **2** breaks a stated security or correctness contract with a realistic path ·
**3** defence-in-depth or robustness gap, low likelihood · **4** hygiene, documentation, accepted risk.

Severity 1–2 findings are fixed here, test first (`test(T057)` then `fix(T057)`). Severity 3–4 findings
are filed as acceptance criteria on the task that owns the area.

## Summary

| Severity | Found | Fixed here | Filed |
| --- | --- | --- | --- |
| 1 | 1 | 1 | – |
| 2 | 3 | 3 | – |
| 3 | 5 | 1 (test gap) | 4 |
| 4 | 7 | – | 7 |

No open Severity 1 or 2 findings.

## Severity 1 (fixed)

**F1 · The no-JS forms had no CSRF protection on any EmDash site.** `POST /_events/checkout` and the
booking page's POST (cancel and redeem forms) had no Origin check of their own and appeared to rely on
Astro's `security.checkOrigin` (default on in Astro 7.3.8) and the `SameSite=Lax` cookie. But **EmDash
1.2's integration sets `security.checkOrigin: false`** (`emdash/dist/astro/index.mjs`), and its own
`checkPublicCsrf` covers only `/_emdash/api` routes, so on every install any page could auto-submit the
checkout form (the T056 load test, posting with `Origin: http://127.0.0.1:4401` to a server whose
`Astro.url` is `http://localhost:4401`, had been going straight through): bookings started in the visitor's name and from the visitor's IP, so a busy third-party
page could hold every seat while each IP stayed under the per-IP reserve limit (Turnstile, if
configured, is the only other stop), plus login-CSRF on the redeem form. Cancel was safe cross-site
only because the explicit `SameSite=Lax` cookie is not sent on a cross-site POST (same-site
subdomains could still do it). Fix: `isCrossSiteRequest` in `src/astro/lib/checkout-form.ts` refuses
a `Sec-Fetch-Site` other than `same-origin`/`none`, else an `Origin` that is neither `url.origin` nor
the request's `Host` (Astro builds `url` on `localhost` without `security.allowedDomains`); clients
that send neither header pass. It answers 403 before the form is read. The endpoint is now
`handleCheckoutRequest`; `BookingPage.astro` checks first. Tests: `tests/ui/checkout-form.test.ts`
(T057 cross-site), `tests/ui/csrf.build.test.ts`, and e2e `apps/playground/e2e/t053-booking-page.spec.ts`
(T057: 403 for checkout, cancel and redeem with a foreign `Origin` or `Sec-Fetch-Site: cross-site`,
on the real playground where Astro's check is off). **E-sign's UI forms may have the same gap**: left
to the T034 review.

## Severity 2 (fixed)

**F2 · `public/event/ics` served events that are not public.** It called `loadEventInfo` without
looking at the config, so a draft, unpublished or orphaned event's title, times and venue came back,
and an id with no config fell back to reading *any* entry of the events collection (drafts included).
`public/event` and the listing answer `NOT_FOUND` for all of these. An unpublished event's id was public
while it was live, so this is reachable. Fix: `loadEventInfo(…, { publicOnly: true })` returns null for
a missing, draft, unpublished or orphaned config; a published config without its `info` copy still
falls back to the entry. Test: `tests/routes/ics.test.ts` (T057 public/event/ics).

**F3 · Cancel could release a booking's seats twice (under-count, oversell window).** A confirmed
booking whose earlier cancel died after claiming it (`releaseClaimedAt` older than `CLAIM_STALE_MS`)
was claimed again and released again. If the first cancel had released, the counters dropped by `qty`
twice, and seats could oversell until the sweeper's rolling drift repair reached the event (the route
does not mark it dirty). Fix: like the sweeper's `close`, a cancel that takes over a stale claim
releases nothing and drift repair (which does not count cancelled bookings) settles the counters; an
over-count meanwhile is the safe direction. Test: `tests/routes/booking.test.ts` (EV-NFR-03 stale claim).

**F4 · The outbox drain could make an 11th bridge call.** The worst tick (two confirmations with
occurrences, 10 calls) that gives up on a message then called `ctx.log.error`, the 11th call, which
throws on Cloudflare (R22, T110 S1). The rows were already written, but the invocation failed and the
log was lost. Fix: `runOutboxJob` meters the drain's calls and logs only when one is left; the row still
records `failed`. Test: `tests/emails/outbox.test.ts` (T057 give-up log). **Same pattern in E-sign**
(`packages/esign/src/emails/outbox.ts:107`): left to the T034 review, which owns that package.

## Severity 3

**F5 · Budget coverage gaps (fixed here, test only).** `public/booking`, `/cancel` and `/redeem` were
measured only with fake-storage meters, the four routes declared for later phases not at all, and the
`/attendees` and `/events` admin page loads (which carry T116's schedule check) were not in the admin
budget test. `tests/public-routes.budget.test.ts` now runs every declared public route (and checks the
set equals `PUBLIC_ROUTES`), the outbox tick and every admin page load through the T007 harness in
workerd. Measured (bridge calls, log calls included):

| Path | Calls |
| --- | --- |
| `public/events` (with schedule check) | 3 |
| `public/event` found / unknown | 5 / 3 |
| `public/checkout/reserve` bad input / new / resubmit | 0 / 8 / 6 |
| `public/checkout/continue` wrong token / confirm / replay | 1 / 6 / 2 |
| `public/booking` wrong token / confirmed | 1 / 6 |
| `public/booking/ics` signed / unsigned | 3 / 1 |
| `public/event/ics` | 2 |
| `public/booking/redeem` wrong code / code / reuse | 1 / 2 / 1 |
| `public/booking/cancel` wrong token / cancel / replay | 1 / 8 / 1 |
| `public/waitlist/*`, `webhooks/stripe`, `signatures/receipt` (stubs) | 0 |
| admin `page_load` `/bookings`, `/attendees`, `/events`, `widget:sales` / `/setup` | 3 / 4 |

Crons were already asserted: `sweep-holds`, `hold-<ref>` (`tests/holds.test.ts`, `tests/cron.hook.test.ts`),
`outbox-drain` (`tests/outbox.hook.test.ts`, worst cases in `tests/emails/outbox.test.ts`), `ensure-schedules`
(`tests/self-schedule.test.ts`); content hooks and `page:metadata` in `tests/event-hooks.test.ts`.

**F6 · Without a Turnstile secret the IP-hash salt is public.** `checkout/reserve` salts `ipHash` with
the Turnstile secret or, when none is set, the plugin id (`semics-events`). Every booking then stores a
hash of the buyer's IP that can be reversed over the IPv4 space, which is close to storing the IP.
Filed: T087 (purge `ipHash` once the rate window has passed) and T100 (a secret salt that does not
cost reserve a call).

**F7 · Phase 2 exit is proven locally, not on staging.** "100 concurrent checkouts on staging never
oversell": T056's `apps/playground/load/checkout.mjs` proves 5 book / 95 `SOLD_OUT` on the local
playground (workerd, SQLite). Staging (D1, Worker Loader) is T111's. Filed: T111.

**F8 · Promo-code uniqueness is case-sensitive on D1.** R26: `uniqueIndexes` compare exactly, so
`SPRING` and `spring` are two codes. Filed: T076 (normalise before storing and looking up).

**F9 · Client-IP headers are forwarded as sent.** `callPublicRoute` passes the visitor's
`x-forwarded-for` (and the other client-IP headers) to the in-process route; the host trusts them only
per `trustedProxyHeaders`. An operator who trusts `x-forwarded-for` without a proxy that overwrites it
lets a visitor pick their IP and step around the per-IP reserve limit. Filed: T103 (operator guide).

## Severity 4

**F10 · `checkout/continue` skips the hash check for an unknown ref.** `public/booking`, `/cancel` and
`/redeem` verify against a decoy hash so an unknown ref costs the same as a wrong token; `continue`
returns early. The answer is identical (`NOT_FOUND`); only timing could tell a live ref apart (refs are
not secrets, tokens are 256-bit). Filed: T100.

**F11 · No per-IP limit on wrong tokens or codes.** `booking`, `cancel`, `redeem` and `continue` have no
rate limit (T048 decision: 256-bit tokens and codes cannot be guessed; a limit would cost a call on
routes near the budget). Accepted; T100 to confirm with the token-entropy review.

**F12 · `lastError` may keep provider text.** The drain stores the first 300 characters of the email
transport's error on the row. A provider that echoes the message would put the booking link, with its
one-time code, in storage (the code still expires in 7 days and dies on first use). Filed: T100.

**F13 · CSV formula defence covers the OWASP set only.** `csvCell` prefixes `=`, `+`, `-`, `@`, tab and
CR. Full-width `＝`/`＋`/`－`/`＠` (which some spreadsheet locales convert) are not covered. Filed: T100.

**F14 · Scaffold `hello` route still declared.** Private (admin), returns the plugin id. Filed: T106.

**F15 · `sold` can over-count briefly.** A drift-repair snapshot taken between continue's move to
`confirmed` and its `confirmSold` writes the tally with the sale, then `confirmSold` adds it again. Only
the reporting counter moves (never `reserved`), and the next pass fixes it. Filed: T085 (reports must not
treat `sold` as exact, or recompute from confirmed bookings).

**F16 · Resubmitting an order re-issues its token.** `checkout/reserve` hands a fresh access token to
any request with the same `idempotencyKey` and the same order. The key is random and lives only in the
widget's form, so this needs the key itself; it is what makes a lost response recoverable. Accepted,
noted for T100.

## Checked, no finding

- **Auth on public routes.** `public/booking`, `/cancel`, `/redeem`, `checkout/continue` take
  `{ bookingRef, accessToken }` (or `code`) in the POST body; `verifyToken` compares SHA-256 hashes in
  constant time; unknown ref, wrong token, expired or used code all answer `NOT_FOUND`
  (`tests/routes/booking.test.ts`, `tests/routes/ics.test.ts`). Bad input is `BAD_REQUEST` with paths,
  never values.
- **Token never in a URL, Referer or log.** `callPublicRoute` refuses token-like keys on GET
  (`TOKEN_IN_QUERY`); the booking ICS route refuses `token`/`accessToken` in its query and carries only
  `ref` + signature (15 min); the cookie `semics_booking_<ref>` is HttpOnly, `SameSite=Lax`, `Secure` on
  https, `Path=/booking`; redirects carry `?ref=` only; the booking page sends `Referrer-Policy:
  no-referrer` (header and meta) and `Cache-Control: private, no-store`. The core's only log calls are
  `hello`, the delete veto (event id) and the give-up count. Emails carry the one-time code, never the
  token (R34).
- **`?k=` redeem.** GET renders only the "Open my booking" form (no cookie read, no core call); the POST
  redeems once (`updateIf` guarded on `redeemHash`), replaces `accessTokenHash`, and redirects without
  `k`; the form's action drops `k`. e2e in `apps/playground/e2e/events.spec.ts` GETs the link twice first.
- **Rate limits.** Reserve counts the IP's bookings in the last 10 minutes by salted `ipHash` (one call);
  T056 made `callPublicRoute` forward the client-IP headers so each visitor is counted (see F6, F9).
- **Inventory.** Guarded `updateIf` per counter in a fixed order with compensation; booking written as
  `draft` before reserving and released before leaving a live status, so drift repair can only
  over-count. Every writer of a held booking guards on `releaseClaimedAt: null` and the status read
  (reserve, continue, extend, cancel); the sweeper's claim, merged release and guarded move restore seats
  on a lost race. Cross-tick drift repair (cursor across 5-minute ticks, writes guarded on the snapshot):
  a booking cancelled in an already-scanned page while a new one lands later can only over-count; a
  release or reservation between snapshot and write turns the fix into a conflict. After F3 no path
  releases a booking twice.
- **JSON-LD and listing.** `public/events`, `public/event` and `page:metadata` carry `available` (or an
  availability word) only, never `reserved`, `sold`, capacities, hidden types or booking data; drafts,
  unpublished and orphaned events are absent; `<` is replaced in every JSON-LD string.
- **CSV.** Formula prefixes and RFC 4180 quoting (`src/admin/csv.ts`, `tests/admin/csv.test.ts`); see F13.
- **Unique indexes (R26).** The criterion asks for proof on real D1. T110's probe on a real D1 database,
  `spikes/cloudflare/results/unique.json`, shows a duplicate value under another id rejected with
  `UNIQUE constraint failed: index 'uidx_…'`, a batch containing a duplicate rejected as a whole
  (`batchFirstRowPresent: false`, so `attendees.putMany` cannot half-write), `null`/missing values not
  colliding, and case-sensitive comparison. EmDash creates every `uniqueIndexes` entry the same way, so
  this covers `bookings.ref`, `attendees.code` and `promo_codes.code` (declared in `emdash-plugin.jsonc`,
  pinned by `tests/manifest.test.ts`) and E-sign's `tokenHash`/`clientId`/`nonce`, whose declarations are
  T034's to confirm. Not redeployed: no gap found. Reserve maps a duplicate `ref` to `INTERNAL`; check-in
  codes are 256-bit tokens.
- **Schedule check (T116).** Only on `public/events`, `public/event` and admin `page_load`s (1–2 calls);
  checkout and admin actions are untouched; all measured under 10 above.

## Code review of the phase diff

Read in full: `src/routes/*`, `src/domain/{inventory,holds,checkout,booking-state,cancel-policy,event-info,link-secret}.ts`,
`src/cron/sweep.ts`, `src/emails/outbox.ts`, `src/hooks/*`, `src/admin/csv.ts`, `src/astro/**` (call helper,
checkout form, booking page, calendar, pass), `src/integration`. Correctness findings are F1–F4 (fixed);
the rest are above.
