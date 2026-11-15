---
"@semics-tech/emdash-events-suite": patch
---

Buy a Voucher layout fixes (T175). The voucher card grows to its content instead of clipping the To / From panel on
narrow screens. `<BuyVoucher />` uses container queries, so it stays one column in a narrow page column (it went
two-column at about 380px). The kind and delivery radios sit at the top right of their cards instead of stretching
above the icon. Field borders default to `#6d7366` through `--events-border` (3:1 or more on white, WCAG 1.4.11; they
were about 1.5:1). The Turnstile widget has space above it. New theming properties: `--voucher-card-font`,
`--voucher-card-title-font`, `--voucher-buy-action-bg` and `--voucher-buy-action-fg` (documented in docs/vouchers.md).
