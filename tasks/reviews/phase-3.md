# Phase 3 gate review: Events ↔ E-sign integration (T067)

Adversarial review of T060–T066 (pairing, intents, receipts, lookup and catalogue, the Events Pro waiver
step and receipt route, the suite package and its pages), the integration code in the Pro repo
(`packages/events-pro/src/waivers/`), and the protocol (`docs/protocol/esign-intent-v1.md`), 2026-10-22.
Reviewed at public `9516501` and Pro `000dd2c` (main, after T074). Severity: **1** exploitable now (data or
token leak, oversell, money) · **2** breaks a stated security or correctness contract with a realistic
path · **3** defence-in-depth or robustness gap, low likelihood · **4** hygiene, documentation, accepted
risk.

Severity 1–2 findings are fixed here, test first (`test(T067)` then `fix(T067)`, in both repos).
Severity 3–4 findings are filed on T119 (new) or recorded as accepted.

## Summary

| Severity | Found | Fixed here | Filed / accepted |
| --- | --- | --- | --- |
| 1 | 0 | – | – |
| 2 | 3 | 3 | – |
| 3 | 5 | 1 (the T066 criterion) | 4 (T119) |
| 4 | 9 | 2 (protocol text) | 7 (T119 or accepted) |

No open Severity 1 or 2 findings.

## How the integration was exercised end to end

The playground cannot load Pro (R40), so the end-to-end proof runs in the Pro repo on **both real
bundles in workerd over one test database**: `events-pro/tests/integration.editions.test.ts` starts Events
Pro with `startEdition("pro")` and the Free e-sign core beside it (`startSideCore("ESIGN")`, new in
`pro-kit/testing/editions.ts`; the e-sign bundle is built from the linked public checkout in
`events-pro/vitest.config.ts`). Each step is what the suite's pages do in-process, route by route, and
**every call goes through the T007 harness with the hard limit of 10 bridge calls** (logs count):

- reserve → continue (buyer inline `self`, minor inline `guardian`, adult `email`) → continuing again
  without receipts never confirms → every intent to e-sign `from-intent` (re-issued intents open no second
  envelope and rotate the inline token; the old one stops working) → ceremony (`public/session` open,
  `public/submit`) → `signatures/receipt` → still waiting for the minor;
- the minor's receipt is never forwarded (closed tab): `public/booking` lists the refs with lookup
  requests, e-sign answers terminal for the minor and pending for the emailed adult, the forwarded
  receipt confirms the booking, one confirmation is queued;
- door signing: check-in refuses the emailed adult with a link; its intent redeemed at e-sign returns a
  signing token for his open emailed envelope (F2), a second redeem is `TOKEN_REPLAYED`, his receipt
  makes him valid and check-in succeeds;
- decline → recorded, not looked up again → retry continue re-issues → e-sign opens envelope `_2` → the
  seat is looked up again (pending) (F4);
- attacks: tampered, replayed and cross-type (lookup token as intent) intents at e-sign; forged (random
  secret), other-client (a second e-sign client's genuine receipt for this ref), tampered-ref,
  cross-type (an intent) and garbage receipts at Events: all refused, nothing written; the genuine receipt
  twice is idempotent; another client's lookup for this ref sees `none`;
- downgrade: switched to the Free build, the waiver event sells and confirms without signing, the
  answers carry no intents or tokens, the waiting Pro booking lists refs but no lookup requests, and
  `signatures/receipt` is `NOT_FOUND` (F1).

The playground e2e (`apps/playground/e2e/waiver.spec.ts`, Free cores, real browser and server) covers
what needs the pages: 403 for cross-site posts to `/_events/waiver` (book and retry), `/_events/sign`,
`/_events/templates` and the booking page's receipt form; the door page moving its intent from the
fragment into a POST (no request URL or Referer carries it), opening the ceremony, and refusing the same
link again; and "Try again" reaching the access token on the waiver page's own path. T065's spec (CSP,
no token in any URL, the cookie cleared) ran green beside it.

**Not covered end to end:** the suite pages driving the *Pro* answers in a browser (they are covered with
faked Pro answers in `packages/events-suite/tests/flow.test.ts`, and the Pro answers against real cores in
the Pro test above); a deployed Cloudflare site (staging is T111; R22 calls and CPU are local proxies);
real email delivery of the adult's invitation (the e-sign outbox row is asserted, not the mail).

**Protocol vectors against both cores.** E-sign: all 53 intent vectors through `from-intent` (T061), all
11 lookup and 10 catalog vectors through their routes and all 19 receipt vectors reproduced by the
issuer (T062). Events: **all 19 receipt vectors through the Events Pro receipt step** (new,
`events-pro/tests/vectors.unit.test.ts`; `CLIENT_UNKNOWN`/`CLIENT_REVOKED` answered `TOKEN_INVALID` as §9
allows). Pairing vectors (9) run in `packages/shared`. "Deployed" here means the built bundles in local
workerd, not staging.

## Severity 2 (fixed)

**F1 · A Pro site switched back to Free could not sell, or open its admin.** EmDash 1.2 stores a `secret`
setting encrypted and `settings.list` throws `PluginSettingEncryptionError: Encrypted plugin setting is not
declared as a secret` for any encrypted value whose key the running manifest does not declare as a
secret. Events Pro declared `licenceKey`, `stripeSecretKey` and `stripeWebhookSecret` only in `pro.json`
(E-sign Pro: `licenceKey`), so after a downgrade every Free `settings.list` threw: reserve, continue,
booking status, the admin, and on e-sign the ceremony. Every production Pro site has a licence key, so
"downgrading switches Pro features off; it never deletes data" (§13) and "keeps selling" failed for all
of them. Found by the downgrade step of the E2E. Fix (BUILD-PLAN **R44**): the Free manifests declare
those secrets, labelled "(Pro)" and ignored by Free (a trust-contract change, in the changeset); Pro gives
them its own wording through the new `pro.json` `settingsText` (label and description only);
`generate.mjs` refuses a secret in `settingsSchema` that Free does not declare, and the Pro build suite
checks every Pro secret is declared by Free. Tests: `packages/{events,esign}/tests/manifest.test.ts` (T067
S10b), Pro `scripts/generate.test.mjs` (T067), `pro-kit/testing/build-suite.ts` (S10b T067), and the E2E
downgrade test. **Any future Pro secret is a public manifest change first** (Pro README step 4).

**F2 · E-sign handed a signing token to the wrong intent, and none to the right one.** §8.1: the token is
present "for `delivery: "inline"` while the envelope awaits this signer". The idempotent return
(`reuse` in `routes/from-intent.ts`) looked only at the *stored* envelope: an inline envelope gave a
freshly rotated token to any intent for that `(cid, ref)`, whoever it named (a re-described seat, or the
door link of an adult seat whose earlier envelope was the buyer's guardian envelope, would get the
buyer's session); an emailed envelope gave none even to an inline intent naming its own signer. So the
door-signing link (EV-FR-12, BUILD-PLAN §3.1 "staff can open the signing page at the door") never worked
for its main case, an adult who had not signed their email: `/_events/sign` answered "may already be
signed". Fix: a token goes only to an inline intent naming the envelope's signer (same lowercased email,
same `as`, same participant), rotated so the emailed link stops working; anyone else gets the envelope
without a token. Protocol §8.1 wording made explicit. Tests: `esign/tests/from-intent.routes.test.ts`
(T067 SX-NFR-03, both directions) and the E2E door test (red against main, green after).

**F3 · "Try again" on the waiver page could never work in a browser.** T066's retry reads the booking's
access token from the `semics_booking_<ref>` cookie, which is `Path=/booking`, so the browser never sends
it to `/_events/waiver`: the retry always fell back to the booking page and a booking that e-sign had
refused stayed held with no way on. The unit test passed because its fake cookie jar ignored paths. Fix:
when e-sign refuses an intent the flow also sets `semics_waiver_access_<ref>` (HttpOnly,
SameSite=Strict, Secure on https, `Path=/_events/waiver`, 60 minutes); retry reads it. Tests:
`events-suite/tests/flow.test.ts` (T067, a path-matching jar) and e2e `waiver.spec.ts` (a real browser).

## Severity 3

**F4 · Reconciliation re-forwarded recorded terminal receipts on every page load (T066 follow-up, the
T067 acceptance criterion; fixed).** `public/booking` listed every seat without a *completed* receipt, so a
declined or expired seat made each status-page load ask e-sign and forward the same receipt again (one
lookup and a 4–5-call receipt replay per ref). Now a seat with a terminal receipt is listed only after
continue re-issued its intent: the sign path marks those signatures `reissued`, and the next receipt for
the seat is stored without the mark. Tests: `events/tests/routes/booking.test.ts`,
`routes/checkout-continue.test.ts`, `domain/receipts.test.ts` (T067 SX-FR-05) and the E2E decline test.

**F5 · An emailed adult who signs without JavaScript is never recorded.** E-sign's 303 lands on
`/booking?ref=#receipt=…`, which needs the client script to post the fragment; `public/booking` lists refs
only while the booking is `awaiting_signature`, and an emailed adult's booking is usually confirmed by
then. The attendee stays pending, check-in refuses them, and the door link (after F2) answers
`completed` without a token. Filed: T119.

**F6 · Downgrade during an in-flight hold.** On Free, continuing a booking still `awaiting_signature`
without attendees replans every seat in the buyer's name (the T066 `storedAttendees` path needs the
signature step), overwriting stored receipts; attendees left `pending` by a waiver can never be checked in
on Free (`WAIVER_PENDING`, no door link, no receipt route). Narrow window (a hold is ≤ 60 minutes).
Filed: T119.

**F7 · Unsigned seats can be re-described mid-flow.** While `awaiting_signature`, a continue with
`attendees` replaces every unsigned seat, so a buyer can flip an adult to "under 18" or change an email.
After F2, e-sign never hands such an intent another person's session, and age is self-declared anyway
(R5); the stored attendee can still disagree with the envelope's signer. Filed: T119.

**F8 · Invitations to arbitrary addresses.** Every other adult's email gets an e-sign invitation from the
site; an order is bounded only by seats per order and the per-IP reserve limit. Filed: T119.

## Severity 4

- **F9 · Intents reach the buyer's browser (fixed in the protocol text).** `public/checkout/continue` is a
  public route and answers `next.intents[].token`, so the holder of the booking's access token can read
  their own intents; §12 said "the browser never sees an intent". It gives them nothing beyond the
  signing it was minted for (after F2). §12 now says so.
- **F10 · Protocol ref format (fixed in the text).** §5 and §5.1 said Events uses
  `<bookingRef>:<attendeeCode>`; it uses `<bookingRef>:<seat>` (T063: the check-in code is a credential and
  would be shown to e-sign admins as `externalRef`).
- **F11 · `safeReturnPath` can return `//evil.example`** (`/.//evil.example` and `/%2e//…` resolve to a
  path starting `//`). Safe today only because `waiverErrorLocation`/`widgetErrorLocation` parse it again
  and keep the path. Filed: T119.
- **F12 · `esign/catalog` accepts any list with a fresh request.** The request (5 minutes, admin panel only)
  is the credential; a forged list could mislabel template ids for the admin, but intents still name a
  template by id and e-sign refuses unknown ones. Accepted.
- **F13 · The retry cookie outlives a successful retry** (60 minutes, HttpOnly, path-scoped). Filed: T119.
- **F14 · A retry whose new intent e-sign refused keeps re-forwarding the old receipt** (the `reissued`
  mark stays until a new envelope's receipt arrives); bounded by the hold. Accepted.
- **F15 · The door redirect puts the signing token in the `/sign/<token>` path.** That is e-sign's own
  link format (emails use it); the page sends no-referrer and no-store, and the token is single-session.
  Accepted (Phase 1).
- **F16 · Free settings show three "(Pro)" fields** after R44. Accepted: the alternative breaks downgrade.
- **F17 · Pro tests link the public main checkout.** T067's Pro branch (`settingsText`, the door E2E) needs
  this public branch landed first; run locally with the Pro worktree's `node_modules` links pointed at
  this worktree (not committed).

## Checked, no finding

- **Pairing and derived secrets (S8).** The pairing string appears only in the `client.create` answer;
  client documents store no secret; secrets are `HMAC(masterKey, clientId)`; ids are unique and never
  reused; revoked clients fail with `CLIENT_REVOKED` on intent, lookup and catalog; Events holds one
  client and answers others `TOKEN_INVALID`.
- **Intents.** Check order and codes are the shared verifier's (vectors); nonce consumed last with a
  create-only write; `exp = min(iat + 1800, holdExpiresAt)` after the hold extension, door intents 15
  minutes; fresh 128-bit nonce per intent; `returnUrl` is the site's `/booking?ref=` (same origin, the
  default allowlist); buyer inline for self and minors, other adults by email, no adult for another adult;
  `TEMPLATE_NOT_FOUND` for an unflagged template.
- **Receipts.** HMAC under the pairing; ref → booking and seat or `REF_UNKNOWN`; idempotent and monotonic
  (`mergeSignature`); a late receipt after the hold is evidence only; other clients', forged, tampered and
  cross-type receipts refused (E2E above).
- **Lookup and catalogue tokens.** Distinct prefixes; 5 minutes; lookups scoped to the token's cid in the
  query and re-filtered in code; catalog requests re-verified by `esign/catalog` before caching.
- **Token transport.** Receipts in the fragment only, cleared with `replaceState` and posted; door
  intents in the fragment and a POST; inline signing tokens in an HttpOnly SameSite=Strict cookie on
  `/_events/waiver`; lookup and catalogue requests in POST bodies in-process; the integration pages send
  `Referrer-Policy: no-referrer` and `no-store`; the waiver page sends `ceremonyCsp()`.
- **Cross-site posts.** `/_events/waiver`, `/_events/sign`, `/_events/templates` and the booking page check
  `isCrossSiteRequest` before reading the form (e2e above).
- **Bridge budgets (R22).** Every route call in the E2E is asserted ≤ 10 calls with logs counted; the
  route tests keep their targets (from-intent 8 inline / 9 email / 10 retry; receipt 8, 9 with an
  occurrence; lookup 3; catalog ≤ 5; continue's sign path 5–6; `public/booking` with lookups 6; check-in
  with the door link within 10). F2 adds no call (the signer is on the envelope document); F4 adds none
  (the mark rides on the sign path's existing `putMany`).

## Code review of the phase diff

Read in full: e-sign `routes/{from-intent,integration,receipts,catalog}.ts`; Events `routes/{receipt,booking,
checkout-continue}.ts`, `domain/receipts.ts`, `astro/lib/{receipt,checkout-form}.ts`, `DoorSignPage.astro`,
`client/receipt.ts`; suite `lib/{flow,form,reconcile,templates}.ts` and its pages; Pro `waivers/*` and
`plugin.ts`. Correctness findings are F1–F4 (fixed); the rest are above.
