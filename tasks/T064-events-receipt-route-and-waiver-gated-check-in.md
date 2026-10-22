---
id: T064
title: "Events: receipt route and waiver-gated check-in"
phase: 3
package: events
edition: pro
status: done
model: opus-5.5
size: M
depends_on: [T063, T071, T118]
spec: [EV-FR-12, SX-FR-04]
---

# T064 · Events: receipt route and waiver-gated check-in

## Definition

`signatures/receipt` verifies and records receipts, advances bookings, and check-in refuses attendees whose waiver is pending.

## Model

**Opus 5.5**: Protocol verification with state changes.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Valid receipt confirms the booking
- [x] Forged or replayed receipt rejected
- [x] Pending attendee refused at check-in with the signing link
- [x] Idempotent on repeat

## Implementation (green, then refactor)

- `src/routes/receipt.ts`

## Acceptance criteria

- [x] Within budget
- [x] Check-in refuses attendees whose booking is not `confirmed` (T049 does not mark attendee docs on cancel)
- [x] On the Events return page, read `#receipt=` from `location.hash`, clear it with `history.replaceState`, POST it to `signatures/receipt`; call `public/receipts/lookup` later for `pdfSha256` (null in the redirect receipt); an Events page embedding `<SigningCeremony>` redirects to `ceremonyRedirect(view)` after a sign/decline post (T062)
- [x] When receipts arrive, move the booking out of `awaiting_signature` (continue re-issues fresh intents while it waits, T063)
- [x] R43 in the Pro repo first: `pro-kit` build suite uses a 256 KiB Pro ceiling per backend (Free stays ≤ 104 KiB), validates Pro structure without the registry size check, and asserts the first invocation of the Pro backend stays within the 50 ms CPU budget
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- **Where the code is (R40/R41).** Public (MIT, this repo) adds seams and the Free-side bookkeeping,
  test-first: `src/routes/receipt.ts` (`signaturesReceiptRoute({ receipts })`, `recordReceipt`),
  `src/domain/receipts.ts` (ref parsing, seats, `mergeSignature`), `adminRoute({ signingLink })` in
  `src/routes/admin.ts` (now also applies the page-load schedule check, so `plugin.ts` no longer wraps it),
  `WAIVER_PENDING` in `checkIn`, and continue's `keepSigned`. Pro (`emdash-plugins-pro`, branch
  `pro-agent-t064`): `src/waivers/receipts.ts` (verification with `verifyReceiptToken` and the pairing
  secret; `CLIENT_UNKNOWN`/`CLIENT_REVOKED` answered as `TOKEN_INVALID`; awaited = inline signers; a
  `lookup` request while `pdfSha256` is null), `src/waivers/door.ts` (the check-in signing link) and
  `planWaiverIntents` skipping signed seats; `plugin.ts` overrides `signatures/receipt` and `admin`.
  **The public seams must land before the Pro branch** (Pro links the public main checkout; the Pro
  worktree's node_modules links were pointed at this worktree locally to test, not committed).
- **The Free `signatures/receipt` route is still the NOT_FOUND stub**, not `signaturesReceiptRoute()`: the
  factory would pull the receipt bookkeeping into the Free bundle for nothing (waivers are Pro). Free
  bundle 95.1 → 95.8 KiB (check-in and admin seam code).
- **Booking rules (PRD EV-FR-12).** The booking leaves `awaiting_signature` once the *inline* signers have
  signed (buyer's own seat and minors, or the one buyer-mode receipt): free → `confirmed` (+`confirmSold`,
  outbox `confirm-<id>`), paid → `awaiting_payment` (the next continue starts the payment step; nothing here
  talks to a provider). Other adults sign by email; their receipts make their attendee `valid` later, even on
  a confirmed booking, and check-in refuses them until then. `declined`/`voided`/`expired` receipts are
  stored (monotonic: a later `at` wins, never over `completed`); the attendee stays pending and the booking
  waits, so continue re-issues an intent (e-sign opens a new envelope for a terminal one, §8.1). A receipt
  after the hold lapsed is stored as evidence and answered `HOLD_EXPIRED`. Receipts and door links are
  in-flight work: no licence check.
- **Idempotency.** Replays write nothing (the hold is not extended either). A replay that finds every awaited
  signature in while the booking still waits (an earlier run died) finishes the move; on a confirmed booking
  a replay checks `outbox.get(confirm-<id>)` and queues the confirmation if an earlier run died before it.
- **Budget (R22).** Settings, booking query, `attendees.getMany`, `attendees.putMany`, then the hold
  extension (5) or the confirm: `updateIf`, `confirmSold` (cut to the budget), outbox = 8 calls for one
  ticket type, **9 with an occurrence** (over the 8 target, within the hard 10; drift repair finishes a cut
  `sold`). Replays 4–5. Continue's sign path on an `awaiting_signature` booking is 6 (+`getMany`). Asserted
  with fake-storage meters here and `withBudget`/`expectWithinBudget` (target 8) on the real Pro bundle in
  `events-pro/tests/receipts.editions.test.ts`, including the admin check-in with the signing link.
- **No rate limit on `signatures/receipt`**: the receipt is an HMAC under the pairing secret (like e-sign's
  lookup and catalog routes); bad input, forged and other clients' tokens are tested.
- **Signing link at check-in.** Events cannot call e-sign from the sandbox, so the link is the Events door
  page `/_events/sign#intent=<token>` (one fresh inline intent for that seat, 15 min, adult signs as `self`,
  a minor's waiver by the buyer as guardian; no link for an adult with only the buyer's address). The page
  moves the fragment into a POST and redeems it in-process with e-sign `public/envelopes/from-intent`, then
  redirects to `/sign/<signingToken>` (e-sign's page); e-sign returns to `/booking?ref=#receipt=`. It needs
  the e-sign core's plugin id: new integration option `esignPluginId` (virtual config exports it, `null` by
  default). The suite (T065) should pass it.
- **Return page.** `/booking` has a hidden form `data-semics-fragment="receipt"`; `src/client/receipt.ts`
  reads `#receipt=`, clears it with `history.replaceState`, fills and submits the form; the page forwards it
  (`forwardReceipt`) and redirects to `?ref=&waiver=signed|declined|voided|expired|failed`. With
  `esignPluginId` set and `pdfSha256` null, it asks `public/receipts/lookup` once with the core's `lookup`
  request and forwards the full receipt; reconciliation on later visits is T066.
- **Not done here:** "an Events page embedding `<SigningCeremony>` redirects to `ceremonyRedirect(view)`":
  no Events page embeds the ceremony yet (the inline flow is the suite's `<BookingWithWaiver>`, T065), so
  that redirect belongs to T065; the Events return page it redirects to is done.
- **R43 (Pro repo, done first).** `pro-kit/testing/structure.ts`: `structureViolations` (Node built-ins,
  admin route for pages/widgets, 256 KiB per file) and `validateProBuild` (CLI build into a temp dir);
  Pro packages' `validate` is now `node ../pro-kit/bin/validate-pro.ts` instead of `emdash-plugin
  validate`; the build suite bundles Free with the registry checks (≤ 104 KiB) and Pro through the new
  validation (≤ 256 KiB), and asserts the cold start (Node CPU to parse and evaluate the backend, best of 3)
  ≤ 50 ms. Pro README step 7 updated.

