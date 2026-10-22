---
id: T076
title: "Events Pro: promo codes and hidden tickets"
phase: 4
package: events
edition: pro
status: done
model: sonnet-5.5
size: S
depends_on: [T073, T071]
spec: [EV-FR-14]
---

# T076 · Events Pro: promo codes and hidden tickets

## Definition

Percent, fixed and unlock codes with usage limits and validity windows; unlock reveals hidden ticket types.

## Model

**Sonnet 5.5**: Contained domain logic.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Discounts calculate in minor units without rounding drift
- [x] Usage limit enforced under concurrency (updateIf)
- [x] Hidden tickets only appear with a valid unlock code

## Implementation (green, then refactor)

- `src/domain/promo.ts`

## Acceptance criteria

- [x] Admin page
- [x] Codes are normalised (trimmed, one case) before they are stored and looked up: the D1 unique index on `promo_codes.code` is case-sensitive (R26; T057 review F8)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

Pro-only change (Pro repo branch `pro-agent-t076`: `b108e8c` tests, `42a70e6` feat). No Free code changed, so Free Events stays at its ~103.4 KiB. The Pro Events backend is 164.4 KiB of the 256 KiB ceiling. Pro `pnpm verify` passed.

- **No Free seam.** `public/checkout/reserve` is overridden with the Free route run over a context whose storage is wrapped (`src/promo/reserve.ts` in the Pro package): Free's `event_configs.get` returns a config copy with hidden types shown for a valid unlock code; Free's draft `bookings.compareAndSet` is rewritten to carry `promoCode` and the discounted `totals`. The Stripe step already charges `totals.totalMinor`, so the session charges the discount.
- **Budget.** A promo reserve (one ticket type) is 9 bridge calls: Free's 6, the code `get` and the guarded redemption `updateIf`, with the optional `hold-<ref>` accelerator dropped when it would be the 10th. The wrapper counts every call and refuses an order whose reserve steps cannot fit (`PROMO_ORDER_TOO_LARGE`, for example two ticket types on a dated event). Promo orders therefore miss the 8-call target but stay within 10. Orders without a code run the untouched Free route (8). The budget assertions live in the Pro repo (`tests/promo.editions.test.ts`); there is nothing new to assert in this repo.
- **Concurrency and limits.** Redemption is an `updateIf` guarded on `active` and `used <= maxUses - 1` with `delta used +1`, run after the draft is created (a resubmit redeems nothing). A miss closes the draft and answers `PROMO_EXHAUSTED`. Expiry, cancel and refund give the use back through the `promo-repair` cron (a recount from the event's live bookings, one code per tick, guarded write), like seat-counter drift repair; a failed reserve decrements at once when the budget allows.
- **F8 (R26).** Codes are NFKC-folded, trimmed and upper-cased by `normaliseCode` before they are stored (document id = code), looked up or created in the admin; a second spelling is a create-only miss.
- **Licence.** Using a code (reserve, `public/promo/check`) and creating one are new work. Listing, disabling and bookings already reserved are never gated. No new setting, so no R44 change.
- **Follow-ups.** The Free event-page UI does not yet send `promoCode` or call `public/promo/check`; adding the form field is a UI task. Unlock codes reveal all of an event's hidden types (per-type selection is not built). `bookings` has no index on the code, so the repair scans an event's bookings (up to 600 per tick; larger events are skipped, as in Free's repair).
