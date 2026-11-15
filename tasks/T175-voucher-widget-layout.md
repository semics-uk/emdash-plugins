---
id: T175
title: "Buy a Voucher widget layout: clipped card, viewport breakpoints, radios, field contrast"
phase: 8
package: events-suite
edition: free
status: review
model: opus-5.5
size: S
depends_on: [T168]
spec: [T163]
---

# T175 · Buy a Voucher widget layout

Reported in lmsc-site #65 on rc.16: five layout bugs in `<BuyVoucher />` and `VoucherCard.astro`.

## Definition

1. The card (`aspect-ratio:.72` with `overflow:hidden`) clipped the To / From panel below about 420px wide.
2. `.layout` and `.fields-two` used viewport media queries, so in a narrow page column the form went two-column.
3. The kind / delivery radios stretched across their column-flex label and sat centred above the icon.
4. Field borders `#cbd3ca` on white were about 1.5:1 (WCAG 1.4.11 needs 3:1).
5. The Turnstile widget had no space above it.

Also: expose the card's fonts and the Buy button's colour as custom properties, documented in docs/vouchers.md.

## Acceptance criteria

- [x] Tests first: `apps/playground/e2e/t175-voucher-widget-layout.spec.ts` (Pro build) at a 375px viewport and in a
      380px container on a 1280px page: card not clipped, one column, radio at the top of its card at its own size,
      field border contrast 3:1 or more (from `getComputedStyle`). Failed on rc.16 before the fix.
- [x] Free Events backend unchanged (suite CSS only).
- [x] Changeset (events-suite patch); docs/vouchers.md "Theming the card and the form".

## Notes

- **Card:** keeps `aspect-ratio:.72` but swaps `overflow:hidden` for `contain:paint`. The aspect ratio's automatic
  minimum only applies with `overflow:visible`, so the card now keeps its portrait shape and grows when the content is
  taller; `contain:paint` still clips the decorative circle. The panel has its own bottom radius. The card is an
  inline-size container and the heading is `clamp(1.8rem,9cqi,2.8rem)` (after a `6vw` fallback), so it scales with
  the card, not the viewport.
- **Columns:** `.semics-buy-voucher` is the `semics-buy-voucher` container (`width:100%`, so it never collapses in a
  shrink-to-fit parent) and `.builder` the `semics-buy-voucher-form` container. Preview beside the form from a 56rem
  container (was a 65rem viewport); fields side by side from a 32rem form (was a 48rem viewport).
- **Radios:** absolutely positioned top right (`top:1rem; right:1rem`), the card padded 2.75rem on the right.
- **Borders:** `var(--events-border,#6b6b6b)` (the property the Events widgets already use for field borders),
  about 5.3:1 on white, with the same default as elsewhere (`scripts/theming.test.mjs` allows one per property). The
  amount buttons' borders are unchanged: their own radio dot identifies them.
- **New properties:** `--voucher-card-font`, `--voucher-card-title-font` (heading and message),
  `--voucher-buy-action-bg` (default the form's accent), `--voucher-buy-action-fg` (default `#fff`).
- **e2e:** run against the Pro build (`EMDASH_PRO_DIR`); skipped on the Free build like t168.
