---
"@semics-tech/emdash-events": patch
---

Waiver receipts and waiver-gated check-in (EV-FR-12, T064). New MIT seams for a Pro build: `signaturesReceiptRoute({ receipts })` stores e-sign receipts per attendee (idempotent, monotonic) and moves a booking out of `awaiting_signature` once its inline signers are in (confirming a free booking, `awaiting_payment` for a paid one), and `adminRoute({ signingLink })` shows a signing link when check-in refuses an attendee whose waiver is pending (new refusal `WAIVER_PENDING`). The Free `signatures/receipt` route is unchanged (NOT_FOUND). Continuing a booking that awaits signatures keeps attendees whose receipts are in. The `/booking` page is the waiver return page (it posts `#receipt=` to `signatures/receipt`), the integration injects `/_events/sign` (door signing) and takes an optional `esignPluginId`.
