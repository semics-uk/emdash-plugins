---
"@semics-tech/emdash-events": minor
---

The booking page now explains what happened after the payment page: paid and confirmed, waiting for the payment provider (it re-reads the booking politely for about 80 seconds, then says we will email), abandoned with the seats still held (a "Pay now" button), expired, refunded, and refunded because the tickets sold out first. The state always comes from the core, never from the URL the provider returns to. New `<PaymentReturn>` component, `resumePayment` helper, and the redirect to the provider is followed only for `https:` URLs.
