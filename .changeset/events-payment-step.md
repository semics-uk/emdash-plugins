---
"@semics-tech/emdash-events": patch
---

The checkout `PaymentStep` extension point now has `prepare` (given the booking as read and the settings checkout already loaded, run before any write, may refuse) and a `start(holdExpiresAt)` that may refuse with an error code. The Free edition is unchanged: it has no payment step and refuses paid bookings with `PAYMENT_FAILED`. Continuing a paid waiver booking that already awaits payment keeps its signed attendees instead of rewriting them.
