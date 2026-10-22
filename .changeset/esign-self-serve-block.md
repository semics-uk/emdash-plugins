---
"@semics-tech/emdash-esign": minor
---

Add the `esign-request` Portable Text block and the `/_esign/start` form endpoint for self-serve signing forms. The route behind them, `public/self-serve/start`, is an E-sign Pro feature; on Free the block shows a short "not available" note instead of a form. Add `esignUi()`'s editor block and the `./astro/SelfServeBlock.astro` and `./astro/self-serve-endpoint` exports.
